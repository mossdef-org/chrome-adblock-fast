'use strict';

import {
	UBUS_STATUS_PERMISSION_DENIED,
	login,
	getInitStatus,
	setInitAction,
} from './lib/ubus-client.js';

import {
	resolveState,
	checkCompat,
	updateIcon,
	updateBadge,
	getConfig,
	getSessionState,
	saveSessionState,
} from './lib/state.js';

const ALARM_NAME = 'poll-status';

async function ensureSession(config) {
	const session = await getSessionState();
	if (session.sessionId) {
		return session.sessionId;
	}

	if (!config.routerUrl || !config.username || !config.password) {
		throw new Error('Extension not configured');
	}

	const result = await login(config.routerUrl, config.username, config.password);
	await saveSessionState({ sessionId: result.sessionId });
	return result.sessionId;
}

async function pollStatus() {
	const config = await getConfig();
	if (!config.routerUrl) {
		await updateIcon('unknown');
		return;
	}

	let session = await getSessionState();

	try {
		let sessionId = await ensureSession(config);
		let status;

		try {
			status = await getInitStatus(config.routerUrl, sessionId);
		} catch (e) {
			if (e.code === UBUS_STATUS_PERMISSION_DENIED) {
				// Session expired, re-login
				await saveSessionState({ sessionId: null });
				sessionId = await ensureSession(config);
				status = await getInitStatus(config.routerUrl, sessionId);
			} else {
				throw e;
			}
		}

		session = await getSessionState();
		const state = resolveState(status, session.pauseEndTime);
		const compatWarning = checkCompat(status);
		await updateIcon(state);
		await updateBadge(status);
		await saveSessionState({
			lastStatus: status,
			lastPoll: Date.now(),
			lastError: null,
			compatWarning: compatWarning,
		});
	} catch (e) {
		await updateIcon('unknown');
		await updateBadge(null);
		await saveSessionState({
			lastStatus: null,
			lastError: e.message,
			lastPoll: Date.now(),
		});
	}
}

async function handleAction(action) {
	const config = await getConfig();
	if (!config.routerUrl) {
		return { success: false, error: 'Extension not configured' };
	}

	try {
		let sessionId = await ensureSession(config);

		if (action === 'pause') {
			// Get current pause_timeout before firing the pause
			const session = await getSessionState();
			const pauseTimeout = (session.lastStatus && session.lastStatus.pause_timeout) || 20;
			const pauseEndTime = Date.now() + (pauseTimeout * 1000);

			// Fire pause without awaiting — it blocks server-side
			setInitAction(config.routerUrl, sessionId, 'pause').catch(() => {});

			await saveSessionState({ pauseEndTime: pauseEndTime });
			await updateIcon('paused');
			return { success: true, pauseEndTime: pauseEndTime };
		}

		try {
			await setInitAction(config.routerUrl, sessionId, action);
		} catch (e) {
			if (e.code === UBUS_STATUS_PERMISSION_DENIED) {
				await saveSessionState({ sessionId: null });
				sessionId = await ensureSession(config);
				await setInitAction(config.routerUrl, sessionId, action);
			} else {
				throw e;
			}
		}

		// Poll immediately after action to update state
		await pollStatus();
		return { success: true };
	} catch (e) {
		return { success: false, error: e.message };
	}
}

// Message handler for popup/settings communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === 'getState') {
		(async () => {
			const session = await getSessionState();
			const config = await getConfig();
			const state = resolveState(session.lastStatus, session.pauseEndTime);
			sendResponse({
				state: state,
				status: session.lastStatus,
				pauseEndTime: session.pauseEndTime,
				lastError: session.lastError,
				compatWarning: session.compatWarning,
				configured: !!(config.routerUrl && config.password),
			});
		})();
		return true; // async sendResponse
	}

	if (message.action === 'setInitAction') {
		handleAction(message.initAction).then(sendResponse);
		return true;
	}

	if (message.action === 'pollNow') {
		pollStatus().then(() => sendResponse({ success: true }));
		return true;
	}

	if (message.action === 'configSaved') {
		saveSessionState({ sessionId: null })
			.then(() => pollStatus())
			.then(() => sendResponse({ success: true }));
		return true;
	}
});

// Alarm-based polling
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === ALARM_NAME) {
		pollStatus();
	}
});

// Set up polling on install/startup
async function setupPolling() {
	const config = await getConfig();
	const interval = Math.max(config.pollInterval || 30, 10);
	await chrome.alarms.clear(ALARM_NAME);
	await chrome.alarms.create(ALARM_NAME, {
		delayInMinutes: 0.1,
		periodInMinutes: interval / 60,
	});
}

chrome.runtime.onInstalled.addListener(setupPolling);
chrome.runtime.onStartup.addListener(setupPolling);

// Re-setup polling when config changes
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes.pollInterval) {
		setupPolling();
	}
});
