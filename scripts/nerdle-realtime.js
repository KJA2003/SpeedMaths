/**
 * nerdle-realtime.js — Centralised ad revenue tracking for all nerdleverse games.
 *
 * Hosted at: nerdlegame.com/maffdoku/scripts/nerdle-realtime.js
 * Source repo: maffdoku/public/scripts/nerdle-realtime.js
 *
 * Usage: add two lines to any repo's HTML:
 *   <script>window.nerdleRealtimeConfig = { page: 'maffdoku' };</script>
 *   <script src="https://nerdlegame.com/maffdoku/scripts/nerdle-realtime.js"></script>
 *
 * Config options (all optional except page):
 *   page         - string, required: game identifier ('maffdoku', 'crossnerdle', etc.)
 *   sampleRate   - number, default 1.0: session sampling rate (0.3 = 30% of sessions)
 *   sendTo       - string, optional: GA4 measurement ID for send_to scoping (e.g. digitdrop)
 *   fallbackPage - string, optional: fallback if page detection fails
 */
(function () {
  'use strict';

  var config = window.nerdleRealtimeConfig || {};
  // Global cap: enforce maximum sampling rate to stay under GA4 BQ 1M events/day cap.
  // Repos with config.sampleRate higher than this (or unset) get capped here.
  //
  // 2026-05-20: reduced from 0.2 → 0.05 as a partial deprecation. The
  // analytical role of these ad events is being taken over by Longitude
  // (unsampled, server-side, no event-cap impact). Keeping 5% gives us
  // ~44K ad events/day for per-user ad-revenue attribution within the
  // sampled cohort, while freeing event-cap headroom for the unsampled
  // app_state event (added below).
  // 2026-06-07: reduced further 0.05 → 0.01. Longitude now covers
  // unsampled revenue/format analysis; the GA4 ad-event stream only
  // needs enough volume to confirm per-user behaviour patterns.
  var SAMPLE_RATE_MAX = 0.01;
  var sampleRate = Math.min(config.sampleRate || 1.0, SAMPLE_RATE_MAX);
  var sendTo = config.sendTo || null;

  // Pages where app_state should NOT fire — for games that have native
  // is_pwa/is_authenticated attached to their inline gtag('config', ...)
  // call. Add page identifiers here as native instrumentation rolls out.
  // Currently empty: all pages fire app_state via this script.
  var APP_STATE_EXCLUDE_PAGES = [];

  // --- Globals ---
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  window.googletag = window.googletag || { cmd: [] };
  window.pbjs = window.pbjs || {};
  window.pbjs.que = window.pbjs.que || [];

  // --- Session-level sampling ---
  if (sampleRate < 1.0) {
    if (sessionStorage.getItem('ad_sample') === null) {
      sessionStorage.setItem('ad_sample', Math.random() < sampleRate ? '1' : '0');
    }
  }

  function isSampled() {
    return sampleRate >= 1.0 || sessionStorage.getItem('ad_sample') !== '0';
  }

  // --- Page identifier ---
  // Prefer window.subdomain (if set and not a generic hostname), then config.page,
  // then GPT section targeting, then config.fallbackPage.
  // This allows repos like bi-nerdle to set subdomain dynamically (bi-quad, bi-octo)
  // without needing per-variant config, while repos on nerdlegame.com/path that get
  // subdomain='nerdlegame' fall through to their hardcoded config.page.
  var _genericHostnames = ['nerdlegame', 'dev', 'localhost', 'www', 'pro'];
  function currentPage() {
    // Handle *.bi.nerdlegame.com (e.g. mini.bi → 'bi-mini') before window.subdomain,
    // because bi-nerdle's index.html overwrites window.subdomain to just hostname[0]
    // which collides with single-subdomain games (mini.nerdlegame.com).
    try {
      var parts = window.location.hostname.split('.');
      if (parts.length > 3 && parts[1] === 'bi') {
        return 'bi-' + parts[0];
      }
    } catch (err) {}
    try {
      if (typeof window.subdomain === 'string' && window.subdomain) {
        var sub = window.subdomain.split('?')[0].split('#')[0];
        if (sub && _genericHostnames.indexOf(sub) === -1) {
          return sub;
        }
      }
    } catch (err) {}
    if (config.page) return config.page;
    try {
      return (googletag.pubads().getTargeting('section') || [])[0] || config.fallbackPage || null;
    } catch (err) { return config.fallbackPage || null; }
  }

  // --- Helpers ---
  function isPWA() {
    try {
      return ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
              window.navigator.standalone === true) ? 1 : 0;
    } catch (err) { return 0; }
  }

  function isAuthenticated() {
    try { return localStorage.getItem('lbl_token') ? 1 : 0; } catch (err) { return 0; }
  }

  // Expose for interstitial tracking in React components
  window.currentPage = currentPage;
  window.isPWA = isPWA;
  window.isAuthenticated = isAuthenticated;

  // --- Default event params for ALL subsequent gtag events ---
  // Attach is_pwa and is_authenticated as default params on every event from
  // this point on — including GA4 auto-fired events (user_engagement, scroll,
  // session_start) and any future explicit gtag('event', ...) calls.
  //
  // Why: gives us is_pwa / is_authenticated coverage on UNSAMPLED events, not
  // just the 20%-sampled ad events below. Lets future analyses classify users
  // without depending on the sampled ad infrastructure.
  //
  // Timing caveat: the very first page_view per page load fires from the
  // inline gtag('config', ...) call BEFORE this script executes — so that
  // initial event misses these params. All subsequent events on the page
  // (user_engagement at ≥10s, next page_view on navigation, our explicit
  // ad/adblock events) will include them. This is sufficient for user-level
  // classification — a user is is_pwa/is_authenticated if ANY of their events
  // has the flag set.
  //
  // Note: existing fireEvent() calls below still explicitly pass these params
  // (cosmetic redundancy, harmless). Kept for clarity until ad-event firing
  // is deprecated.
  // --- Custom unsampled state event (canonical is_pwa/is_authenticated source) ---
  // Fires one event per page load carrying is_pwa + is_authenticated. This is
  // the primary mechanism for classifying users across the nerdleverse — does
  // not rely on per-repo native instrumentation, works regardless of whether
  // the host page uses raw gtag.js or Firebase Analytics SDK.
  //
  // Volume: ~1 per page load on non-excluded pages (~165K/day with empty
  // exclusion list). Drops as repos opt-out via APP_STATE_EXCLUDE_PAGES — but
  // see the 2026-05-20 finding: Firebase setDefaultEventParameters does NOT
  // propagate to page_view auto events, so per-repo native instrumentation
  // hasn't been a viable opt-out path. Currently expect APP_STATE_EXCLUDE_PAGES
  // to stay empty.
  if (typeof window.gtag === 'function') {
    var _appStatePage = currentPage();
    if (APP_STATE_EXCLUDE_PAGES.indexOf(_appStatePage) === -1) {
      window.gtag('event', 'app_state', {
        page: _appStatePage,
        is_pwa: isPWA(),
        is_authenticated: isAuthenticated(),
      });
    }
  }

  function fireEvent(name, params) {
    if (typeof window.gtag !== 'function') return;
    if (sendTo) params.send_to = sendTo;
    if (sampleRate < 1.0) params.sample_rate = sampleRate;
    window.gtag('event', name, params);
  }

  // --- Adblock signal tracking (for detection accuracy) ---
  // Track signals that ads ARE serving — used to suppress false positives.
  // Signals are collected for ALL sessions (not gated by isSampled) so the
  // adblock detection runs accurately even for unsampled sessions.
  var _adSignals = {
    gptLoaded: false,
    slotRendered: false,
    videoSeen: false
  };

  // --- Display ad tracking (GPT slotRenderEnded + impressionViewable) ---
  googletag.cmd.push(function () {
    _adSignals.gptLoaded = true;
    googletag.pubads().addEventListener('slotRenderEnded', function (e) {
      if (e.isEmpty) return;
      _adSignals.slotRendered = true;  // before sample gate — signal regardless
      if (!isSampled()) return;

      var slotId = e.slot.getSlotElementId();
      var adUnit = e.slot.getAdUnitPath();
      var size = Array.isArray(e.size) ? e.size.join('x') : (e.size || null);

      // Prebid client-side bid match (prefix-match for lngtd adUnitCodes)
      var win = null;
      var topBid = null;
      try {
        var prebidAdUnit = null;
        if (window.pbjs && typeof pbjs.getBidResponses === 'function') {
          var codes = Object.keys(pbjs.getBidResponses() || {});
          prebidAdUnit = codes
            .filter(function (c) { return c === slotId || slotId.indexOf(c) === 0; })
            .sort(function (a, b) { return b.length - a.length; })[0] || null;
        }
        if (prebidAdUnit && typeof pbjs.getAllWinningBids === 'function') {
          win = pbjs.getAllWinningBids().filter(function (b) {
            return b.adUnitCode === prebidAdUnit && b.status === 'rendered';
          }).pop() || null;
        }
        if (prebidAdUnit && typeof pbjs.getHighestCpmBids === 'function') {
          topBid = (pbjs.getHighestCpmBids(prebidAdUnit) || [])[0] || null;
        }
      } catch (err) { /* pbjs not ready */ }

      // GPT slot targeting fallback (server-side Prebid bids)
      var hbBidder = null, hbPb = null, hbSource = null, hbFormat = null;
      try {
        hbBidder = (e.slot.getTargeting('hb_bidder') || [])[0] || null;
        hbPb = parseFloat((e.slot.getTargeting('hb_pb') || [])[0]) || null;
        hbSource = (e.slot.getTargeting('hb_source') || [])[0] || null;
        hbFormat = (e.slot.getTargeting('hb_format') || [])[0] || null;
      } catch (err) { /* targeting not available */ }

      // Priority: pbjs win > hb_* targeting > gam_direct
      var eventBidder = win ? win.bidderCode : (hbBidder || 'gam_direct');
      var eventCpm = win ? Number(win.cpm) : (hbPb || null);
      var eventCurrency = win ? win.currency : null;
      var eventAuctionId = win ? win.auctionId : null;
      var eventIsPrebidWin = (win || hbBidder) ? 1 : 0;

      fireEvent('ad_rendered', {
        page: currentPage(),
        unit_type: hbFormat || 'display',
        is_pwa: isPWA(),
        is_authenticated: isAuthenticated(),
        ad_slot: slotId,
        ad_unit: adUnit,
        ad_size: size,
        cpm: eventCpm,
        currency: eventCurrency,
        bidder: eventBidder,
        is_prebid_win: eventIsPrebidWin,
        auction_id: eventAuctionId,
        hb_source: hbSource,
        prebid_top_cpm: topBid ? Number(topBid.cpm) : hbPb,
        gam_advertiser_id: e.advertiserId || null,
        gam_campaign_id: e.campaignId || null,
        gam_line_item_id: e.lineItemId || null,
        gam_creative_id: e.creativeId || null,
        gam_is_backfill: e.isBackfill ? 1 : 0,
      });
    });

    // ad_viewable disabled to stay under GA4 BQ 1M events/day limit.
    // Re-enable if headroom allows — useful for slot-level viewability analysis.
    // googletag.pubads().addEventListener('impressionViewable', function (e) {
    //   if (!isSampled()) return;
    //   fireEvent('ad_viewable', {
    //     page: currentPage(),
    //     is_pwa: isPWA(),
    //     is_authenticated: isAuthenticated(),
    //     ad_slot: e.slot.getSlotElementId(),
    //     ad_unit: e.slot.getAdUnitPath(),
    //   });
    // });
  });

  // --- Video ad tracking (IMA SDK + lngtd player) ---
  var _lastVideoEventTime = 0;
  function _fireVideoEvent(slot, size) {
    var now = Date.now();
    if (now - _lastVideoEventTime < 500) return; // dedup
    _lastVideoEventTime = now;
    _adSignals.videoSeen = true;  // signal regardless of sampling
    if (!isSampled()) return;
    fireEvent('ad_rendered', {
      page: currentPage(),
      unit_type: 'video',
      is_pwa: isPWA(),
      is_authenticated: isAuthenticated(),
      ad_slot: slot || 'video_unknown',
      ad_unit: 'video_outstream',
      ad_size: size || 'outstream',
      cpm: null,
      bidder: 'lngtd_video',
      is_prebid_win: 0,
    });
  }

  // IMA SDK: postMessage from imasdk.googleapis.com
  window.addEventListener('message', function (e) {
    try {
      if (typeof e.data === 'string' && e.data.indexOf('ima://') === 0) {
        var json = JSON.parse(e.data.substring(6));
        if (json.name === 'adsManager' && json.type === 'start') {
          var ad = json.data && json.data.adData;
          var sz = (ad && ad.vastMediaWidth && ad.vastMediaHeight)
            ? ad.vastMediaWidth + 'x' + ad.vastMediaHeight : 'outstream';
          _fireVideoEvent('video_ima_' + (json.sid || 'unknown'), sz);
        }
      }
    } catch (err) { /* IMA parse error */ }
  });

  // lngtd player: console.log('videoAutoplayImpression')
  var _lastVideoSlot = 'video_lngtd';
  var _origConsoleLog = console.log;
  console.log = function () {
    if (typeof arguments[0] === 'string' && arguments[0].indexOf('loading video:') === 0) {
      var parts = arguments[0].split(' ');
      _lastVideoSlot = parts[parts.length - 1] || 'video_lngtd';
    }
    if (arguments[0] === 'videoAutoplayImpression') {
      _fireVideoEvent(_lastVideoSlot, 'outstream');
      _lastVideoSlot = 'video_lngtd';
    }
    _origConsoleLog.apply(console, arguments);
  };

  // --- Interstitial ad tracking (auto-wraps lngtd.triggerInterstitial) ---
  // Works for any game that uses lngtd interstitials (nerdle, bi-nerdle, etc.)
  // No per-repo code needed — the wrapper intercepts the adBreakDone callback.
  var _interstitialWrapped = false;
  function wrapInterstitial() {
    if (_interstitialWrapped || !window.lngtd || !window.lngtd.triggerInterstitial) return;
    _interstitialWrapped = true;
    var origTrigger = window.lngtd.triggerInterstitial.bind(window.lngtd);
    window.lngtd.triggerInterstitial = function (opts, type) {
      var origDone = opts.adBreakDone;
      opts.adBreakDone = function () {
        if (isSampled()) {
          fireEvent('ad_rendered', {
            page: currentPage(),
            unit_type: 'interstitial',
            is_pwa: isPWA(),
            is_authenticated: isAuthenticated(),
            ad_slot: type || 'interstitial_video',
            ad_unit: 'interstitial_video',
            ad_size: 'fullscreen',
            cpm: null,
            bidder: 'lngtd',
            is_prebid_win: 0,
          });
        }
        if (origDone) origDone.apply(this, arguments);
      };
      return origTrigger(opts, type);
    };
  }
  wrapInterstitial();
  var _interstitialPoll = setInterval(function () {
    wrapInterstitial();
    if (_interstitialWrapped) clearInterval(_interstitialPoll);
  }, 2000);

  // --- Bid error monitoring (5% sample, fetch intercept) ---
  // Catches CORS/timeout errors from ad bidder endpoints.
  // Heavily sampled to avoid quota impact — just enough to quantify the problem.
  var _bidErrorSample = Math.random() < 0.05; // 5% of sessions
  if (_bidErrorSample && typeof window.fetch === 'function') {
    var _bidErrorCount = {};
    var _origFetch = window.fetch;
    window.fetch = function () {
      var url = arguments[0] && typeof arguments[0] === 'string' ? arguments[0] : '';
      return _origFetch.apply(this, arguments).catch(function (err) {
        // Only log errors from known ad/bidder domains
        var match = url.match(/adsrvr\.org|unrulymedia\.com|a-mo\.net|prebid|sharethrough|rubiconproject/);
        if (match) {
          var bidder = match[0];
          // Max 3 errors per bidder per session to avoid flooding
          _bidErrorCount[bidder] = (_bidErrorCount[bidder] || 0) + 1;
          if (_bidErrorCount[bidder] <= 3) {
            fireEvent('ad_bid_error', {
              page: currentPage(),
              bidder_domain: bidder,
              error_type: err.message || 'fetch_failed',
              error_count: _bidErrorCount[bidder],
            });
          }
        }
        throw err;
      });
    };
  }

  // --- Adblock detection (multi-signal) ---
  // Waits 20 seconds, then checks if any ad infrastructure activated:
  //   1. googletag.cmd queue processed (GPT loaded)
  //   2. A non-empty ad slot rendered (display ad served, incl. via Blockthrough)
  //   3. A video ad started (lngtd/IMA video served)
  // Any signal → not blocked. No signals after 20s → blocked.
  //
  // 25 seconds is generous to handle slow networks. Signals are collected from
  // page load onwards (see _adSignals setup near top of file), so users with
  // slow GPT loading still get classified correctly.
  function detectAdblock(callback) {
    setTimeout(function () {
      var blocked = !_adSignals.gptLoaded
        && !_adSignals.slotRendered
        && !_adSignals.videoSeen;
      callback(blocked);
    }, 25000);
  }

  // Brave masquerades as Chrome in user-agent, so GA4's auto-captured
  // device.web_info.browser shows 'Chrome' for Brave. navigator.brave is
  // a Brave-only API — other Chromium browsers (Edge, Opera, Vivaldi)
  // don't define it. Synchronous feature-detection avoids async timing
  // issues with navigator.brave.isBrave() returning a Promise.
  function isBraveSync() {
    try {
      return (navigator.brave && typeof navigator.brave.isBrave === 'function') ? 1 : 0;
    } catch (err) { return 0; }
  }

  function runAdblockDetection() {
    // Now firing for all pages (including main nerdle). Event volume manageable
    // because we only fire when blocked (~3-5% of sessions).
    detectAdblock(function (blocked) {
      // Only fire when blocked — non-blocked rate inferred from page_view count
      // to keep BQ event volume down.
      if (!blocked) return;
      // Detection class: captures which signals failed.
      // Currently only 'no_signals' (all three flags false) reaches this path,
      // but logging the breakdown future-proofs the data if logic changes.
      var detectionClass;
      if (!_adSignals.gptLoaded && !_adSignals.slotRendered && !_adSignals.videoSeen) {
        detectionClass = 'no_signals';   // GPT script blocked entirely — high confidence
      } else if (!_adSignals.gptLoaded) {
        detectionClass = 'no_gpt';       // GPT didn't load but something rendered
      } else if (!_adSignals.slotRendered && !_adSignals.videoSeen) {
        detectionClass = 'gpt_only';     // GPT loaded but no ads served (no bids or blocked slots)
      } else {
        detectionClass = 'partial';      // Mixed signals
      }
      fireEvent('adblock_status', {
        page: currentPage(),
        is_blocked: 1,
        is_brave: isBraveSync(),
        is_pwa: isPWA(),
        is_authenticated: isAuthenticated(),
        detection_class: detectionClass,
        gpt_loaded: _adSignals.gptLoaded ? 1 : 0,
        slot_rendered: _adSignals.slotRendered ? 1 : 0,
        video_seen: _adSignals.videoSeen ? 1 : 0,
      });
    });
  }

  if (document.body) {
    runAdblockDetection();
  } else {
    document.addEventListener('DOMContentLoaded', runAdblockDetection);
  }
})();
