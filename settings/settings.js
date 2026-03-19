'use strict';

import { login, getInitStatus } from '../lib/ubus-client.js';
import { getConfig, saveConfig } from '../lib/state.js';

const API_USERNAME = 'adblock-fast-api';

const elRouterUrl = document.getElementById('routerUrl');
const elPassword = document.getElementById('password');
const elPollInterval = document.getElementById('pollInterval');
const btnTest = document.getElementById('btnTest');
const btnSave = document.getElementById('btnSave');
const elStatus = document.getElementById('statusMessage');

function showMessage(text, type) {
	elStatus.textContent = text;
	elStatus.className = 'status-message ' + type;
	elStatus.hidden = false;
}

function hideMessage() {
	elStatus.hidden = true;
}

async function loadSettings() {
	const config = await getConfig();
	elRouterUrl.value = config.routerUrl || '';
	elPassword.value = config.password || '';
	elPollInterval.value = config.pollInterval || 30;
}

async function saveSettings() {
	const config = {
		routerUrl: elRouterUrl.value.trim().replace(/\/+$/, ''),
		username: API_USERNAME,
		password: elPassword.value,
		pollInterval: Math.max(10, Math.min(240, parseInt(elPollInterval.value) || 30)),
	};

	if (!config.routerUrl) {
		showMessage('Router URL is required.', 'error');
		return;
	}
	if (!config.password) {
		showMessage('Remote Access Token is required.', 'error');
		return;
	}

	await saveConfig(config);
	showMessage('Settings saved.', 'success');

	// Clear old session and trigger an immediate poll
	chrome.runtime.sendMessage({ action: 'configSaved' });
}

async function testConnection() {
	hideMessage();

	const routerUrl = elRouterUrl.value.trim().replace(/\/+$/, '');
	const password = elPassword.value;

	if (!routerUrl || !password) {
		showMessage('Please fill in Router URL and Remote Access Token first.', 'error');
		return;
	}

	btnTest.disabled = true;
	btnTest.textContent = 'Testing...';

	try {
		const session = await login(routerUrl, API_USERNAME, password);
		const status = await getInitStatus(routerUrl, session.sessionId);

		let msg = 'Connection successful!';
		if (status.version) msg += ' Service version: ' + status.version + '.';
		if (status.entries) msg += ' Blocking ' + status.entries + ' domains.';
		showMessage(msg, 'success');

		// Auto-save settings and trigger fresh poll to update icon
		const config = {
			routerUrl: routerUrl,
			username: API_USERNAME,
			password: password,
			pollInterval: Math.max(10, Math.min(240, parseInt(elPollInterval.value) || 30)),
		};
		await saveConfig(config);
		chrome.runtime.sendMessage({ action: 'configSaved' });
	} catch (e) {
		let msg = 'Connection failed: ' + e.message;
		if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
			msg += ' — Check the router URL and ensure the router is reachable.';
			msg += ' If using HTTPS with a self-signed certificate, visit the router URL in a browser tab first.';
		}
		showMessage(msg, 'error');
	} finally {
		btnTest.disabled = false;
		btnTest.textContent = 'Test Connection';
	}
}

btnSave.addEventListener('click', saveSettings);
btnTest.addEventListener('click', testConnection);

loadSettings();
