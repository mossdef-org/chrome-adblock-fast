'use strict';

(function () {
	const beacon = {
		source: 'adblock-fast-extension',
		type: 'beacon',
		version: chrome.runtime.getManifest().version,
	};
	window.postMessage(beacon, '*');
	window.addEventListener('message', function (ev) {
		if (ev.source !== window) return;
		const d = ev.data;
		if (!d || typeof d !== 'object') return;
		if (d.source === 'luci-adblock-fast' && d.type === 'extension-ping') {
			window.postMessage(beacon, '*');
		}
	});
})();
