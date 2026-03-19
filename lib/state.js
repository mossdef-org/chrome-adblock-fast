'use strict';

const STATES = {
	ACTIVE: 'active',
	STOPPED: 'stopped',
	PAUSED: 'paused',
	UNKNOWN: 'unknown',
};

const ICON_PATHS = {};
for (const state of Object.values(STATES)) {
	ICON_PATHS[state] = {
		16: 'icons/icon-' + state + '-16.png',
		32: 'icons/icon-' + state + '-32.png',
		48: 'icons/icon-' + state + '-48.png',
		128: 'icons/icon-' + state + '-128.png',
	};
}

function resolveState(status, pauseEndTime) {
	if (pauseEndTime && Date.now() < pauseEndTime) {
		return STATES.PAUSED;
	}
	if (!status) {
		return STATES.UNKNOWN;
	}
	switch (status.status) {
		case 'statusSuccess':
			return STATES.ACTIVE;
		case 'statusStopped':
		case 'statusFail':
			return STATES.STOPPED;
		case 'statusStarting':
		case 'statusRestarting':
		case 'statusDownloading':
		case 'statusProcessing':
			return STATES.UNKNOWN;
		default:
			return STATES.UNKNOWN;
	}
}

async function updateIcon(state) {
	try {
		await chrome.action.setIcon({ path: ICON_PATHS[state] });
	} catch (e) {
		// Icon update can fail if extension context is invalidated
	}
}

async function updateBadge(status) {
	try {
		if (status && status.entries) {
			const text = status.entries >= 1000
				? Math.floor(status.entries / 1000) + 'k'
				: String(status.entries);
			await chrome.action.setBadgeText({ text: text });
			await chrome.action.setBadgeBackgroundColor({ color: '#666' });
		} else {
			await chrome.action.setBadgeText({ text: '' });
		}
	} catch (e) {
		// Badge update can fail if extension context is invalidated
	}
}

async function getConfig() {
	const result = await chrome.storage.local.get({
		routerUrl: '',
		username: 'adblock-fast-api',
		password: '',
		pollInterval: 30,
	});
	return result;
}

async function saveConfig(config) {
	await chrome.storage.local.set(config);
}

async function getSessionState() {
	const result = await chrome.storage.session.get({
		sessionId: null,
		lastStatus: null,
		pauseEndTime: null,
		lastPoll: 0,
		lastError: null,
	});
	return result;
}

async function saveSessionState(state) {
	await chrome.storage.session.set(state);
}

function formatPauseTimeout(seconds) {
	const s = parseInt(seconds) || 20;
	if (s < 60) return s + 's';
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (rem === 0) return m + 'm';
	return m + 'm ' + rem + 's';
}

export {
	STATES,
	ICON_PATHS,
	resolveState,
	updateIcon,
	updateBadge,
	getConfig,
	saveConfig,
	getSessionState,
	saveSessionState,
	formatPauseTimeout,
};
