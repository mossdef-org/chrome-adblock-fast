'use strict';

import { formatPauseTimeout } from '../lib/state.js';

const elNotConfigured = document.getElementById('notConfigured');
const elStatusPanel = document.getElementById('statusPanel');
const elStatusValue = document.getElementById('statusValue');
const elEntriesValue = document.getElementById('entriesValue');
const elVersionValue = document.getElementById('versionValue');
const elErrorBox = document.getElementById('errorBox');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnPause = document.getElementById('btnPause');

let pauseCountdownTimer = null;

function openSettingsPage() {
	chrome.runtime.openOptionsPage();
}

document.getElementById('openSettings').addEventListener('click', (e) => {
	e.preventDefault();
	openSettingsPage();
});
document.getElementById('footerSettings').addEventListener('click', (e) => {
	e.preventDefault();
	openSettingsPage();
});

const STATUS_LABELS = {
	statusSuccess: 'Active',
	statusStopped: 'Stopped',
	statusFail: 'Failed',
	statusStarting: 'Starting...',
	statusRestarting: 'Restarting...',
	statusDownloading: 'Downloading...',
	statusProcessing: 'Processing...',
};

function updateUI(data) {
	if (!data.configured) {
		elNotConfigured.hidden = false;
		elStatusPanel.hidden = true;
		return;
	}

	elNotConfigured.hidden = true;
	elStatusPanel.hidden = false;

	const status = data.status;
	const isPaused = data.pauseEndTime && Date.now() < data.pauseEndTime;

	// Status text
	if (isPaused) {
		elStatusValue.textContent = 'Paused';
		elStatusValue.className = 'status-value paused';
	} else if (status) {
		const label = STATUS_LABELS[status.status] || status.status || 'Unknown';
		elStatusValue.textContent = label;
		elStatusValue.className = 'status-value ' + data.state;
	} else {
		elStatusValue.textContent = data.lastError ? 'Error' : 'Unknown';
		elStatusValue.className = 'status-value unknown';
	}

	// Entries
	if (status && status.entries) {
		elEntriesValue.textContent = status.entries.toLocaleString();
	} else {
		elEntriesValue.textContent = '--';
	}

	// Version
	if (status && status.version) {
		elVersionValue.textContent = status.version;
	} else {
		elVersionValue.textContent = '--';
	}

	// Error box
	if (data.lastError && !isPaused) {
		elErrorBox.textContent = data.lastError;
		elErrorBox.hidden = false;
	} else {
		elErrorBox.hidden = true;
	}

	// Button states
	const enabled = status && status.enabled;
	const running = status && status.status === 'statusSuccess';
	const stopped = status && (status.status === 'statusStopped' || status.status === 'statusFail');
	const transitional = status && !running && !stopped;

	if (isPaused) {
		btnStart.disabled = true;
		btnStop.disabled = true;
		btnPause.disabled = true;
		startPauseCountdown(data.pauseEndTime, status);
	} else {
		btnStart.disabled = !enabled || !stopped;
		btnStop.disabled = !enabled || !running;
		btnPause.disabled = !enabled || !running;

		if (status && status.pause_timeout) {
			btnPause.textContent = 'Pause (' + formatPauseTimeout(status.pause_timeout) + ')';
		} else {
			btnPause.textContent = 'Pause';
		}
	}

	if (transitional) {
		btnStart.disabled = true;
		btnStop.disabled = true;
		btnPause.disabled = true;
	}
}

function startPauseCountdown(pauseEndTime, status) {
	clearInterval(pauseCountdownTimer);

	function tick() {
		const remaining = Math.max(0, Math.ceil((pauseEndTime - Date.now()) / 1000));
		if (remaining <= 0) {
			clearInterval(pauseCountdownTimer);
			btnPause.textContent = 'Restarting...';
			// Poll for updated status after pause completes
			setTimeout(() => {
				chrome.runtime.sendMessage({ action: 'pollNow' }, () => {
					refreshState();
				});
			}, 2000);
			return;
		}
		btnPause.textContent = 'Paused (' + formatPauseTimeout(remaining) + ')';
	}

	tick();
	pauseCountdownTimer = setInterval(tick, 1000);
}

function setAllButtonsDisabled(disabled) {
	btnStart.disabled = disabled;
	btnStop.disabled = disabled;
	btnPause.disabled = disabled;
}

async function sendAction(action) {
	setAllButtonsDisabled(true);
	const response = await chrome.runtime.sendMessage({
		action: 'setInitAction',
		initAction: action,
	});

	if (response && !response.success) {
		elErrorBox.textContent = response.error || 'Action failed';
		elErrorBox.hidden = false;
	}

	refreshState();
}

async function refreshState() {
	const data = await chrome.runtime.sendMessage({ action: 'getState' });
	if (data) updateUI(data);
}

btnStart.addEventListener('click', () => sendAction('start'));
btnStop.addEventListener('click', () => sendAction('stop'));
btnPause.addEventListener('click', () => sendAction('pause'));

// Initial load
refreshState();
