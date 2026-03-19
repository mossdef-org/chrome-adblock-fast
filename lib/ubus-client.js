'use strict';

const ANONYMOUS_SESSION = '00000000000000000000000000000000';
const UBUS_STATUS_OK = 0;
const UBUS_STATUS_PERMISSION_DENIED = 6;

let rpcId = 1;

async function ubusCall(url, sessionId, object, method, args) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: rpcId++,
			method: 'call',
			params: [sessionId, object, method, args || {}],
		}),
	});

	if (!response.ok) {
		throw new Error('HTTP ' + response.status + ': ' + response.statusText);
	}

	const data = await response.json();

	if (data.error) {
		throw new Error(data.error.message || 'RPC error');
	}

	if (!data.result || !Array.isArray(data.result)) {
		throw new Error('Unexpected response format');
	}

	const statusCode = data.result[0];
	if (statusCode === UBUS_STATUS_PERMISSION_DENIED) {
		const err = new Error('Permission denied or session expired');
		err.code = UBUS_STATUS_PERMISSION_DENIED;
		throw err;
	}
	if (statusCode !== UBUS_STATUS_OK) {
		throw new Error('ubus error code: ' + statusCode);
	}

	return data.result[1] || {};
}

async function login(routerUrl, username, password) {
	const url = routerUrl.replace(/\/+$/, '') + '/ubus';
	const result = await ubusCall(url, ANONYMOUS_SESSION, 'session', 'login', {
		username: username,
		password: password,
	});

	if (!result.ubus_rpc_session) {
		throw new Error('Login failed: no session token received');
	}

	return {
		sessionId: result.ubus_rpc_session,
		timeout: result.timeout || 300,
		expires: result.expires || {},
	};
}

async function getInitStatus(routerUrl, sessionId) {
	const url = routerUrl.replace(/\/+$/, '') + '/ubus';
	const result = await ubusCall(url, sessionId, 'luci.adblock-fast', 'getInitStatus', {
		name: 'adblock-fast',
	});
	return result['adblock-fast'] || result;
}

async function setInitAction(routerUrl, sessionId, action) {
	const url = routerUrl.replace(/\/+$/, '') + '/ubus';
	const result = await ubusCall(url, sessionId, 'luci.adblock-fast', 'setInitAction', {
		name: 'adblock-fast',
		action: action,
	});
	return result;
}

export {
	UBUS_STATUS_PERMISSION_DENIED,
	login,
	getInitStatus,
	setInitAction,
};
