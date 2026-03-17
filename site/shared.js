// ── Config ──
var MINTDAY = {
  contract: "0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c",
  rpcs: [
    "https://mainnet.base.org",
    "https://1rpc.io/base",
    "https://base-mainnet.public.blastapi.io",
    "https://base.llamarpc.com"
  ],
  explorer: "https://basescan.org",
  github: "https://github.com/jordanlyall/mintday",
  x: "https://x.com/mintdotday",
  npm: "https://www.npmjs.com/package/mint-day",
  fromBlock: 43460000,
  typeNames: ["Identity", "Attestation", "Credential", "Receipt", "Pass"],
  typeColors: {
    Identity:    { bg: "#eff6ff", accent: "#3b82f6", text: "#1d4ed8" },
    Attestation: { bg: "#f0faf5", accent: "#2db87a", text: "#1e9e65" },
    Credential:  { bg: "#faf5ff", accent: "#a855f7", text: "#7e22ce" },
    Receipt:     { bg: "#fffbeb", accent: "#e5a030", text: "#b45309" },
    Pass:        { bg: "#ecfeff", accent: "#0891b2", text: "#0e7490" },
  },
  mintedSig: "0xcaf90953c630066d72a36149d0170187181e7b386b987ac551e117b7b0ff06c4"
};

// ── RPC helper with fallback ──
async function rpcCall(method, params) {
  for (var i = 0; i < MINTDAY.rpcs.length; i++) {
    try {
      var res = await fetch(MINTDAY.rpcs[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
      });
      var json = await res.json();
      if (json.error) continue;
      return json.result;
    } catch (e) { continue; }
  }
  throw new Error("All RPCs failed");
}

// ── Inject favicon ──
(function() {
  var link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#FFFDF8" stroke="#E4DFD2" stroke-width="1"/><circle cx="16" cy="16" r="5.5" fill="#2db87a"/></svg>');
  document.head.appendChild(link);
})();

// ── Render shared nav ──
function renderNav(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var nav = document.createElement("nav");

  var logo = document.createElement("a");
  logo.href = "/";
  logo.className = "logo";
  logo.textContent = "mint";
  var dot = document.createElement("span");
  dot.className = "dot";
  dot.textContent = ".";
  logo.appendChild(dot);
  logo.appendChild(document.createTextNode("day"));
  nav.appendChild(logo);

  var links = document.createElement("div");
  links.className = "nav-links";

  // Live counter (hidden until loaded)
  var counter = document.createElement("a");
  counter.href = "/feed";
  counter.className = "nav-counter";
  counter.id = "nav-counter";
  var pulseDot = document.createElement("span");
  pulseDot.className = "pulse-dot";
  counter.appendChild(pulseDot);
  var countSpan = document.createElement("span");
  countSpan.id = "nav-count";
  counter.appendChild(countSpan);
  links.appendChild(counter);

  // OpenSea
  var os = document.createElement("a");
  os.href = "https://opensea.io/collection/mintdotday";
  os.target = "_blank";
  os.title = "OpenSea";
  os.appendChild(makeSvg("opensea"));
  links.appendChild(os);

  // GitHub
  var gh = document.createElement("a");
  gh.href = MINTDAY.github;
  gh.target = "_blank";
  gh.title = "GitHub";
  gh.appendChild(makeSvg("github"));
  links.appendChild(gh);

  // X
  var x = document.createElement("a");
  x.href = MINTDAY.x;
  x.target = "_blank";
  x.title = "X";
  x.appendChild(makeSvg("x"));
  links.appendChild(x);

  nav.appendChild(links);
  container.appendChild(nav);

  // Load counter
  loadNavCounter();
}

// ── Render shared footer ──
function renderFooter(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var footer = document.createElement("footer");

  var left = document.createElement("span");
  left.className = "footer-left";
  left.textContent = "mint.day ";
  var by = document.createElement("a");
  by.href = "https://x.com/jordanlyall";
  by.target = "_blank";
  by.textContent = "built by @jordanlyall";
  by.style.color = "var(--text-dim)";
  by.style.textDecoration = "none";
  by.style.marginLeft = "8px";
  left.appendChild(by);
  footer.appendChild(left);

  var links = document.createElement("div");
  links.className = "footer-links";

  var items = [
    { text: "github", href: MINTDAY.github },
    { text: "contract", href: MINTDAY.explorer + "/address/" + MINTDAY.contract },
    { text: "npm", href: MINTDAY.npm }
  ];

  items.forEach(function(item) {
    var a = document.createElement("a");
    a.href = item.href;
    a.target = "_blank";
    a.textContent = item.text;
    links.appendChild(a);
  });

  footer.appendChild(links);
  container.appendChild(footer);
}

// ── Load nav counter ──
async function loadNavCounter() {
  try {
    // totalMinted() selector
    var result = await rpcCall("eth_call", [{ to: MINTDAY.contract, data: "0xa2309ff8" }, "latest"]);
    var count = parseInt(result, 16);
    var el = document.getElementById("nav-counter");
    var countEl = document.getElementById("nav-count");
    countEl.textContent = count + " minted";
    el.style.display = "inline-flex";
  } catch (e) { /* silent */ }
}

// ── SVG icons (DOM-built, no innerHTML) ──
function makeSvg(name) {
  var ns = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");

  var path = document.createElementNS(ns, "path");
  if (name === "github") {
    path.setAttribute("d", "M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z");
  } else if (name === "opensea") {
    svg.setAttribute("viewBox", "0 0 90 90");
    path.setAttribute("d", "M45 0C20.151 0 0 20.151 0 45c0 24.849 20.151 45 45 45 24.849 0 45-20.151 45-45C90 20.151 69.849 0 45 0zM22.203 46.512l.252-.504 12.06-18.858c.18-.27.54-.234.684.054 2.016 4.464 3.762 10.008 2.952 13.464-.342 1.404-1.278 3.312-2.34 5.058-.126.252-.27.486-.414.72-.072.108-.198.162-.324.162H22.563c-.306 0-.486-.342-.36-.612v-.504zm52.38 5.4c0 .198-.126.36-.306.432-1.098.468-4.842 2.196-6.408 4.374-3.978 5.562-7.02 13.518-13.824 13.518H32.49c-10.116 0-18.324-8.226-18.324-18.378v-.324c0-.234.18-.414.414-.414h13.41c.27 0 .468.252.45.522-.09.72.054 1.458.432 2.124.72 1.332 2.07 2.16 3.528 2.16h5.526v-4.266h-5.472c-.306 0-.486-.36-.342-.63.054-.09.108-.18.18-.288.54-.828 1.314-2.142 2.088-3.636.522-.99 1.026-2.034 1.422-3.096.09-.198.162-.396.234-.576.126-.36.252-.702.342-1.044.09-.288.162-.594.234-.882.198-1.008.27-2.07.27-3.168 0-.432-.018-.882-.054-1.314-.018-.486-.072-.972-.144-1.458-.054-.414-.144-.828-.234-1.26-.126-.612-.288-1.224-.486-1.836l-.072-.252c-.144-.468-.27-.918-.432-1.386-1.044-3.042-2.178-5.94-3.276-8.478l-.234-.504c-.072-.162-.144-.306-.216-.45-.198-.414-.414-.81-.63-1.188-.108-.198-.234-.378-.342-.558-.144-.234-.306-.45-.432-.648-.09-.144-.198-.27-.288-.396l-.774-.972c-.09-.108.036-.27.162-.234l4.212 1.116h.018l.558.162.612.18.216.054V17.37c0-1.602 1.278-2.898 2.844-2.898.792 0 1.494.324 2.016.846.522.522.828 1.242.828 2.052v7.776l.45.126c.036.018.072.036.108.072.126.108.306.27.54.468.18.162.378.36.612.576.468.432 1.026.99 1.602 1.62.162.18.324.36.468.558.612.738 1.296 1.584 1.944 2.52.18.27.36.54.522.828.486.828.918 1.692 1.278 2.574.126.288.234.594.306.882v.036c.108.306.18.63.234.954.162.882.234 1.8.162 2.736-.036.378-.09.738-.162 1.116-.09.378-.18.738-.306 1.116-.252.72-.558 1.422-.918 2.07-.126.234-.27.486-.414.72-.162.234-.306.468-.468.684-.216.306-.45.594-.666.864-.198.252-.414.504-.63.738-.324.378-.648.72-.99 1.044-.198.216-.414.414-.63.594-.216.198-.432.378-.63.54-.324.27-.612.486-.864.666l-.558.396c-.09.072-.216.108-.324.108h-3.366v4.266h4.176c.954 0 1.854-.342 2.574-.954.252-.216 2.736-2.376 5.886-6.462.018-.036.072-.072.126-.09l14.652-4.266c.27-.072.54.126.54.396v.504z");
  } else if (name === "x") {
    path.setAttribute("d", "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z");
  }
  svg.appendChild(path);
  return svg;
}

// ── Decode Minted event log ──
function decodeMintedLog(log) {
  var tokenId = parseInt(log.topics[1], 16);
  var to = "0x" + log.topics[2].slice(26);
  var data = log.data.slice(2);
  var tokenType = parseInt(data.slice(0, 64), 16);
  var soulbound = parseInt(data.slice(64, 128), 16) === 1;

  var strOffset = parseInt(data.slice(128, 192), 16) * 2;
  var strLen = parseInt(data.slice(strOffset, strOffset + 64), 16);
  var strHex = data.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  var tokenURI = "";
  try { tokenURI = new TextDecoder().decode(new Uint8Array(strHex.match(/.{2}/g).map(function(b) { return parseInt(b, 16); }))); } catch (e) {}

  var metadata = {};
  if (tokenURI.startsWith("data:application/json;base64,")) {
    try { metadata = JSON.parse(atob(tokenURI.replace("data:application/json;base64,", ""))); } catch (e) {}
  }

  return { tokenId: tokenId, to: to, tokenType: tokenType, soulbound: soulbound, metadata: metadata, blockNumber: parseInt(log.blockNumber, 16), txHash: log.transactionHash };
}

// ── Time ago from block number ──
function timeAgo(blockNum, latestBlock) {
  var seconds = (latestBlock - blockNum) * 2;
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}
