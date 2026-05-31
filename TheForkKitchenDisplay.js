// ==UserScript==
// @name         TheFork manager - Kitchen display
// @license      GPL
// @author       Nova Chervet
// @namespace    http://tampermonkey.net/
// @version      1.6.1
// @description  Displays a kitchen view in TheFork manager
// @icon         https://avatars.githubusercontent.com/u/1640261?s=200&v=4
// @match        https://manager.thefork.com/*
// @exclude      https://manager.thefork.com/*/login
// @exclude      https://manager.thefork.com/login
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @downloadURL https://update.greasyfork.org/scripts/556851/TheFork%20manager%20-%20Kitchen%20display.user.js
// @updateURL https://update.greasyfork.org/scripts/556851/TheFork%20manager%20-%20Kitchen%20display.meta.js
// ==/UserScript==

(function() {
	'use strict';

	const DEFAULT_AUTO_REFRESH_INTERVAL = 60_000;
	const DEFAULT_GROUP_MIN_COVER = 12;

	let autoRefreshInterval = GM_getValue('autoRefreshInterval', null);
	if (!autoRefreshInterval) {
		autoRefreshInterval = DEFAULT_AUTO_REFRESH_INTERVAL;
		GM_setValue('autoRefreshInterval', autoRefreshInterval);
	}

	let groupMinCover = GM_getValue('groupMinCover', null);
	if (!groupMinCover) {
		groupMinCover = DEFAULT_GROUP_MIN_COVER;
		GM_setValue('groupMinCover', groupMinCover);
	}

	const GRAPHQL_URL = 'https://manager.thefork.com/api/graphql';

	const DEFAULT_DINING_AREA_RULES = [
		{ label: 'Salle à manger', ranges: [[1, 9]] },
		{ label: 'Café', ranges: [[10, 18]] },
		{ label: '1er étage', ranges: [[20, 48]] },
		{ label: 'Billard', numbers: [49] },
		{ label: 'Jardin d’hiver', numbers: [19], ranges: [[50, 70]] },
		{ label: 'Jardin 1', ranges: [[71, 90]] },
		{ label: 'Jardin 2', ranges: [[150, 159]] },
		{ label: 'Bord du lac', ranges: [[300, 306]] },
		{ label: 'Cave', ranges: [[501, 505]] },
	];

	let selectedService = 'lunch';
	let groupsViewActive = false;
	let normalizedData = { lunch: [], dinner: [] };
	let groupData = [];
	let autoRefreshId = null;
	let dateOffsetDays = 0;
	let currentDate = null;

	GM_addStyle(`
		/* Bouton flottant */
		#bk-toggle-btn {
			position: fixed;
			right: 16px;
			bottom: 20px;
			z-index: 999999;
			background: #22c55e;
			color: #020617;
			border: none;
			border-radius: 999px;
			padding: 6px 14px;
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			box-shadow: 0 6px 18px rgba(0,0,0,0.35);
			font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}
		#bk-toggle-btn:hover { background: #16a34a; }

		/* Overlay global */
		#bk-overlay {
			position: fixed;
			inset: 0;
			z-index: 999998;
			display: none;
			align-items: center;
			justify-content: center;
			font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}

		#bk-container {
			position: relative;
			width: 100vw;
			height: 100vh;
			background: #020617;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		/* Header */
		#bk-header {
			height: 60px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 8px 14px;
			background: linear-gradient(to right, #020617, #0b1120);
			border-bottom: 1px solid rgba(37,99,235,0.6);
			color: #e5e7eb;
			font-size: 13px;
		}
		#bk-header-left {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		#bk-header-dot {
			width: 9px;
			height: 9px;
			border-radius: 999px;
			background: #22c55e;
			box-shadow: 0 0 8px rgba(34,197,94,0.9);
		}
		#bk-header-dot.ok {
			background: #10b981; /* vert */
		}
		#bk-header-dot.loading {
			background: #f59e0b; /* orange */
		}
		#bk-header-dot.error {
			background: #ef4444; /* rouge */
		}

		#bk-header-title {
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
		}
		#bk-header-subtitle {
			color: #9ca3af;
			font-size: 11px;
		}

		#bk-header-right {
			display: flex;
			align-items: center;
			gap: 10px;
		}

		/* Tabs service */
		#bk-service-tabs {
			display: inline-flex;
			border-radius: 999px;
			border: 1px solid #4b5563;
			overflow: hidden;
			background: #020617;
		}
		.bk-service-tab {
			padding: 4px 10px;
			font-size: 11px;
			cursor: pointer;
			color: #9ca3af;
			border: none;
			background: transparent;
			text-transform: uppercase;
			letter-spacing: 0.08em;
		}
		.bk-service-tab-active {
			background: #1d4ed8;
			color: #e5e7eb;
		}

		#bk-groups-btn {
			border-radius: 999px;
			border: 1px solid #4b5563;
			background: #020617;
			color: #e5e7eb;
			font-size: 11px;
			padding: 4px 10px;
			cursor: pointer;
			text-transform: uppercase;
			letter-spacing: 0.08em;
		}
		#bk-groups-btn:hover { background: #0f172a; }
		#bk-groups-btn.bk-groups-active {
			background: #7c3aed;
			border-color: #a78bfa;
			color: #f5f3ff;
		}

		#bk-groups-panel {
			flex: 1;
			display: none;
			flex-direction: column;
			gap: 8px;
			min-height: 0;
			overflow-y: auto;
		}

		.bk-group-card {
			border-radius: 12px;
			border: 1px solid #374151;
			padding: 8px 10px;
			background: rgba(15,23,42,0.97);
			display: flex;
			flex-direction: column;
			gap: 6px;
			box-shadow: 0 6px 10px rgba(0,0,0,0.45);
		}

		.bk-group-card-header {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 12px;
		}

		.bk-group-date {
			font-size: 1rem;
			font-weight: 700;
			color: #e5e7eb;
		}

		.bk-group-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
			font-size: 0.78rem;
			color: #9ca3af;
		}

		.bk-group-service {
			padding: 0.08rem 0.55rem;
			border-radius: 999px;
			border: 1px solid #4b5563;
			background: #020617;
			color: #d1d5db;
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}

		.bk-group-card {
			cursor: pointer;
		}
		.bk-group-card:hover {
			border-color: #a78bfa;
			background: rgba(30,41,59,0.98);
		}

		.bk-group-card.bk-group-missing-menu {
			border-color: #ef4444;
			background: linear-gradient(
				135deg,
				rgba(127,29,29,0.92),
				rgba(15,23,42,0.97) 58%
			);
			box-shadow: 0 0 0 1px rgba(239,68,68,0.45), 0 8px 18px rgba(0,0,0,0.55);
		}

		.bk-group-card.bk-group-missing-menu:hover {
			border-color: #fca5a5;
			background: linear-gradient(
				135deg,
				rgba(153,27,27,0.96),
				rgba(30,41,59,0.98) 58%
			);
		}

		.bk-group-alert-badge {
			font-size: 0.72rem;
			padding: 0.1rem 0.55rem;
			border-radius: 999px;
			border: 1px solid #fca5a5;
			background: rgba(239,68,68,0.18);
			color: #fecaca;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			font-weight: 700;
		}

		#bk-menu-modal-backdrop {
			position: fixed;
			inset: 0;
			z-index: 1000000;
			display: none;
			align-items: center;
			justify-content: center;
			background: rgba(2,6,23,0.78);
			backdrop-filter: blur(4px);
		}

		#bk-menu-modal {
			width: min(760px, calc(100vw - 32px));
			max-height: calc(100vh - 48px);
			display: flex;
			flex-direction: column;
			border-radius: 18px;
			border: 1px solid #475569;
			background: #020617;
			color: #e5e7eb;
			box-shadow: 0 24px 70px rgba(0,0,0,0.65);
			overflow: hidden;
		}

		#bk-menu-modal-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 16px;
			padding: 14px 16px;
			border-bottom: 1px solid #1f2937;
			background: linear-gradient(to right, #0f172a, #111827);
		}

		#bk-menu-modal-title {
			font-size: 1.05rem;
			font-weight: 700;
		}

		#bk-menu-modal-subtitle {
			margin-top: 3px;
			font-size: 0.78rem;
			color: #9ca3af;
		}

		#bk-menu-modal-contact {
			margin-top: 5px;
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			font-size: 0.78rem;
			color: #d1d5db;
		}

		.bk-menu-modal-contact-item {
			padding: 0.08rem 0.5rem;
			border-radius: 999px;
			border: 1px solid #334155;
			background: rgba(15,23,42,0.86);
			color: #cbd5e1;
		}

		#bk-menu-modal-close {
			border-radius: 999px;
			border: 1px solid #64748b;
			background: transparent;
			color: #e5e7eb;
			font-size: 0.85rem;
			padding: 4px 9px;
			cursor: pointer;
		}
		#bk-menu-modal-close:hover { background: rgba(148,163,184,0.16); }

		#bk-menu-modal-body {
			padding: 14px 16px 16px;
			overflow-y: auto;
		}

		.bk-menu-section {
			border-radius: 12px;
			border: 1px solid #1f2937;
			background: rgba(15,23,42,0.95);
			padding: 10px 12px;
			margin-bottom: 10px;
		}

		.bk-menu-section-title {
			font-size: 0.76rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: #a78bfa;
			margin-bottom: 6px;
			font-weight: 700;
		}

		.bk-menu-items {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.bk-menu-item {
			font-size: 0.9rem;
			line-height: 1.35;
			color: #e5e7eb;
		}

		.bk-menu-note {
			border-radius: 10px;
			border: 1px solid #374151;
			background: rgba(15,23,42,0.95);
			padding: 8px 10px;
			margin-bottom: 10px;
			font-size: 0.82rem;
			color: #d1d5db;
		}

		#bk-summary {
			font-size: 11px;
			color: #9ca3af;
		}

		#bk-header-buttons {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		#bk-refresh-btn {
			border-radius: 999px;
			border: 1px solid #4b5563;
			background: #020617;
			color: #e5e7eb;
			font-size: 11px;
			padding: 3px 8px;
			cursor: pointer;
		}
		#bk-refresh-btn:hover { background: #0f172a; }
		#bk-refresh-btn.bk-refresh-loading {
			opacity: 0.6;
			cursor: wait;
		}
		#bk-day-toggle-btn {
			border-radius: 999px;
			border: 1px solid #4b5563;
			background: #020617;
			color: #e5e7eb;
			font-size: 11px;
			padding: 3px 8px;
			cursor: pointer;
      height: 25px;
		}
		#bk-day-toggle-btn:hover { background: #0f172a; }

		#bk-date-wrapper {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			border-radius: 999px;
			border: 1px solid #4b5563;
			background: #020617;
			padding: 0 6px;
			height: 25px;
		}

		#bk-date-icon {
			font-size: 11px;
			opacity: 0.75;
			line-height: 1;
		}

		#bk-date-input {
			border: none;
			outline: none;
			background: transparent;
			color: #e5e7eb;
			font-size: 11px;
			height: 18px;
			min-width: 90px;
		}

		#bk-date-input::-webkit-calendar-picker-indicator {
			filter: invert(1);
		}

		#bk-close-btn {
			border-radius: 999px;
			border: 1px solid #6b7280;
			background: transparent;
			color: #e5e7eb;
			font-size: 12px;
			padding: 3px 9px;
			cursor: pointer;
		}
		#bk-close-btn:hover { background: rgba(148,163,184,0.2); }

		/* Corps */
		#bk-body {
			flex: 1;
			display: flex;
			flex-direction: column;
			padding: 10px 14px 12px 14px;
			color: #e5e7eb;
			background: radial-gradient(circle at top, rgba(37,99,235,0.10), transparent 55%);
            overflow: auto;
		}

		#bk-top-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
			font-size: 12px;
			color: #9ca3af;
		}

		#bk-last-refresh { font-size: 11px; }

		/* Colonnes status */
		#bk-columns {
			flex: 1;
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 10px;
			min-height: 0;
		}
		.bk-column {
			display: flex;
			flex-direction: column;
			background: rgba(15,23,42,0.95);
			border-radius: 12px;
			border: 1px solid #1f2937;
			overflow: hidden;
		}
		.bk-column-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 4px 8px;
			font-size: 11px;
			color: #9ca3af;
			border-bottom: 1px solid #111827;
			background: rgba(15,23,42,0.9);
		}
		.bk-column-title { text-transform: uppercase; letter-spacing: 0.08em; }

		.bk-column-count {
			font-size: 11px;
			color: #d1d5db;
		}

		.bk-column-body {
			flex: 1;
			padding: 6px 6px 6px 6px;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.bk-empty {
			font-size: 11px;
			color: #6b7280;
			padding: 4px 4px 2px;
		}

		/* Cards */
		.bk-card {
			border-radius: 10px;
			border: 1px solid #374151;
			padding: 6px 7px;
			background: rgba(15,23,42,0.97);
			display: flex;
			flex-direction: column;
			gap: 4px;
			box-shadow: 0 6px 10px rgba(0,0,0,0.45);
		}
		.bk-card-header {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
		}
		.bk-card-time {
			font-size: 1.1rem;
			font-weight: 600;
			letter-spacing: 0.05em;
		}
		.bk-card-covers {
			font-size: 0.78rem;
			padding: 0.1rem 0.65rem;
			border-radius: 999px;
			background: rgba(249,115,22,0.16);
			color: #fb923c;
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}
		.bk-card-main {
			display: flex;
			justify-content: space-between;
			gap: 1rem;
			font-size: 0.8rem;
			color: #9ca3af;
		}
		.bk-card-main-col {
			flex: 1;
			min-width: 0;
		}
		.bk-card-label {
			font-size: 0.7rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			opacity: 0.7;
			margin-bottom: 0.1rem;
		}
		.bk-card-value {
			font-size: 0.85rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.bk-notes {
			display: flex;
			flex-direction: column;
			gap: 0.15rem;
			font-size: 0.78rem;
			color: #9ca3af;
		}
		.bk-note-line {
			overflow: hidden;
			margin-bottom: 0.1rem;
		}
		.bk-note-label {
			opacity: 0.75;
			margin-right: 0.25rem;
		}

		.bk-card-footer {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-top: 2px;
		}
		.bk-status-on_site {
			border-color: #22c55e;
			color: #22c55e;
			background: rgba(16,185,129,0.12);
		}
		.bk-status-to_arrive {
			border-color: #eab308;
			color: #eab308;
			background: rgba(250,204,21,0.08);
		}
		.bk-status-finished {
			border-color: #6b7280;
			color: #9ca3af;
			background: rgba(31,41,55,0.8);
		}

		.bk-vip-badge {
			display: inline-block;
			font-size: 0.7rem;
			padding: 0.05rem 0.35rem;
			margin-left: 0.25rem;
			border-radius: 6px;
			background: #ffd70033;
			color: #ffd700;
			border: 1px solid #ffd700aa;
			font-weight: 600;
			letter-spacing: 0.04em;
			text-transform: uppercase;
		}

		#bk-error {
			font-size: 11px;
			color: #f97373;
			margin-top: 4px;
		}

		.bk-menu-modal-contact-item {
			text-decoration: none;
			color: #e5e7eb;
		}

		.bk-menu-modal-contact-item:hover {
			color: #a78bfa;
			text-decoration: underline;
		}
	`);

	function setStatus(status) {
		const dot = document.getElementById('bk-header-dot');
		if (!dot) return;

		dot.classList.remove('ok', 'loading', 'error');
		dot.classList.add(status);
	}

	function selectServiceForCurrentTime() {
		const now = new Date();
		const hour = now.getHours();

		selectedService = hour >= 15 ? 'dinner' : 'lunch';
		updateServiceTabs();
	}

	function getTheForkToken() {
		try {
			const ls = (typeof unsafeWindow !== 'undefined' && unsafeWindow.localStorage)
				? unsafeWindow.localStorage
				: window.localStorage;

			const raw = ls.getItem('tfm-front:persist');
			if (!raw) return null;

			let data = JSON.parse(raw);

			if (typeof data === 'string') {
				data = JSON.parse(data);
			}

			if (data && data.token) {
				return data.token;
			}
		} catch (e) {
			setStatus('error');
			console.error('[TheFork kitchen display] Erreur lecture token TheFork', e);
		}
		return null;
	}

	function decodeJwtPayload(token) {
		try {
			const parts = token.split('.');
			if (parts.length < 2) return null;

			let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
			while (base64.length % 4) {
				base64 += '=';
			}

			const json = atob(base64);
			return JSON.parse(json);
		} catch (e) {
			setStatus('error');
			console.error('[TheFork kitchen display] Erreur décodage JWT', e);
			return null;
		}
	}

	function getRestaurantUuid() {
		const token = getTheForkToken();
		if (!token) return null;

		const payload = decodeJwtPayload(token);
		if (!payload) return null;

		if (payload.restaurantUuid) {
			return payload.restaurantUuid;
		}

		if (Array.isArray(payload.restaurants) && payload.restaurants.length > 0) {
			const r0 = payload.restaurants[0];
			return r0.restaurantUuid || r0.uuid || null;
		}

		return null;
	}

	function escapeHtml(str) {
		return String(str || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function formatTime(isoStr) {
		if (!isoStr) return '?';
		const d = new Date(isoStr);
		if (isNaN(d.getTime())) return '?';
		return d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
	}

	function formatPriceChf(value) {
		const n = Number(value);
		if (!Number.isFinite(n)) return '';

		if (Number.isInteger(n)) {
			return `${n}.--`;
		}

		return n.toFixed(2);
	}

	function formatDateHuman(date) {
		const d = date instanceof Date ? date : new Date(date);
		if (isNaN(d.getTime())) return '';
		const opts = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
		return d.toLocaleDateString('fr-CH', opts);
	}

	function formatDateId(date) {
		const d = date instanceof Date ? date : new Date(date);
		if (isNaN(d.getTime())) return '';
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function addDays(date, days) {
		const d = new Date(date);
		d.setDate(d.getDate() + days);
		return d;
	}

	function mapServiceFromReservation(r) {
		const name = (r.serviceInstance && r.serviceInstance.service && r.serviceInstance.service.name) || '';
		const lname = name.toLowerCase();
		if (lname.includes('midi')) return 'lunch';
		if (lname.includes('soir')) return 'dinner';

		const d = r.mealDate ? new Date(r.mealDate) : null;
		if (!d || isNaN(d.getTime())) return 'lunch';
		const h = d.getHours();
		if (h < 17) return 'lunch';
		return 'dinner';
	}

	function mapStatusForKitchen(status) {
		const s = (status || '').toUpperCase();
		if (s === 'ARRIVED' || s === 'SEATED' || s === 'BILL') {
			return 'on_site';
		}
		if (s === 'NO_SHOW' || s === 'LEFT' || s === 'CANCELED') {
			return 'finished';
		}
		if (s === 'RECORDED' && s !== 'REQUESTED') {
			return 'to_arrive';
		}
		return 'unknown';
	}


	function getTableNumber(tableName) {
		const match = String(tableName || '').match(/\d+/);
		if (!match) return null;

		const n = Number(match[0]);
		return Number.isFinite(n) ? n : null;
	}

	function cloneDefaultDiningAreaRules() {
		return JSON.parse(JSON.stringify(DEFAULT_DINING_AREA_RULES));
	}

	function normalizeDiningAreaRules(rules) {
		if (!Array.isArray(rules)) {
			return cloneDefaultDiningAreaRules();
		}

		const normalized = [];

		rules.forEach(rule => {
			if (!rule || !rule.label) return;

			const label = String(rule.label).trim();
			if (!label) return;

			const cleanRule = { label };

			if (Array.isArray(rule.numbers)) {
				const numbers = rule.numbers
					.map(n => Number(n))
					.filter(n => Number.isInteger(n));

				if (numbers.length) {
					cleanRule.numbers = numbers;
				}
			}

			if (Array.isArray(rule.ranges)) {
				const ranges = rule.ranges
					.map(range => {
						if (!Array.isArray(range) || range.length < 2) return null;

						const from = Number(range[0]);
						const to = Number(range[1]);

						if (!Number.isInteger(from) || !Number.isInteger(to)) return null;

						return from <= to ? [from, to] : [to, from];
					})
					.filter(Boolean);

				if (ranges.length) {
					cleanRule.ranges = ranges;
				}
			}

			if (cleanRule.numbers || cleanRule.ranges) {
				normalized.push(cleanRule);
			}
		});

		return normalized.length ? normalized : cloneDefaultDiningAreaRules();
	}

	function getDiningAreaRules() {
		const saved = GM_getValue('diningAreaRules', null);

		if (!saved) {
			const defaults = cloneDefaultDiningAreaRules();
			GM_setValue('diningAreaRules', JSON.stringify(defaults, null, '\t'));
			return defaults;
		}

		try {
			const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
			return normalizeDiningAreaRules(parsed);
		} catch (e) {
			console.warn('[TheFork kitchen display] Configuration des salles invalide, fallback défaut', e);
			return cloneDefaultDiningAreaRules();
		}
	}

	function saveDiningAreaRules(rules) {
		const normalized = normalizeDiningAreaRules(rules);
		GM_setValue('diningAreaRules', JSON.stringify(normalized, null, '\t'));
		return normalized;
	}

	function configureDiningAreaRules() {
		const current = JSON.stringify(getDiningAreaRules(), null, '\t');

		const next = prompt(
			'Configuration des salles en JSON:\\n\\nExemple: [{"label":"Salle","ranges":[[1,9]],"numbers":[49]}]',
			current
		);

		if (next === null) {
			return;
		}

		try {
			const parsed = JSON.parse(next);
			const normalized = saveDiningAreaRules(parsed);

			alert(
				'Configuration des salles sauvegardée.\\n' +
				normalized.length + ' zone(s) configurée(s).\\n\\n' +
				'Recharge la vue cuisine pour appliquer les changements.'
			);
		} catch (e) {
			alert('JSON invalide: ' + e.message);
		}
	}

	function resetDiningAreaRules() {
		const ok = confirm('Réinitialiser les noms de salles et numéros de tables avec la configuration par défaut ?');
		if (!ok) return;

		saveDiningAreaRules(cloneDefaultDiningAreaRules());
		alert('Configuration des salles réinitialisée. Recharge la vue cuisine pour appliquer les changements.');
	}

	function normalizeAutoRefreshInterval(value) {
		const n = Number(value);

		if (!Number.isFinite(n) || n < 5) {
			return DEFAULT_AUTO_REFRESH_INTERVAL;
		}

		return Math.round(n * 1000);
	}

	function saveAutoRefreshInterval(value) {
		autoRefreshInterval = normalizeAutoRefreshInterval(value);
		GM_setValue('autoRefreshInterval', autoRefreshInterval);

		if (autoRefreshId) {
			clearInterval(autoRefreshId);
			autoRefreshId = setInterval(() => fetchAndRender(false), autoRefreshInterval);
		}

		return autoRefreshInterval;
	}

	function configureAutoRefreshInterval() {
		const currentSeconds = Math.round((Number(autoRefreshInterval) || DEFAULT_AUTO_REFRESH_INTERVAL) / 1000);

		const next = prompt(
			'Intervalle de rechargement automatique en secondes:',
			String(currentSeconds)
		);

		if (next === null) {
			return;
		}

		const n = Number(next);
		if (!Number.isFinite(n) || n < 5) {
			alert('Valeur invalide. Mets un nombre de secondes, minimum 5.');
			return;
		}

		const saved = saveAutoRefreshInterval(n);
		alert('Intervalle sauvegardé: ' + Math.round(saved / 1000) + ' seconde(s).');
	}

	function resetAutoRefreshInterval() {
		const ok = confirm('Réinitialiser le rechargement automatique à ' + Math.round(DEFAULT_AUTO_REFRESH_INTERVAL / 1000) + ' secondes ?');
		if (!ok) return;

		const saved = saveAutoRefreshInterval(DEFAULT_AUTO_REFRESH_INTERVAL / 1000);
		alert('Intervalle réinitialisé: ' + Math.round(saved / 1000) + ' seconde(s).');
	}

	function normalizeGroupMinCover(value) {
		const n = Number(value);

		if (!Number.isFinite(n) || n < 1) {
			return DEFAULT_GROUP_MIN_COVER;
		}

		return Math.round(n);
	}

	function saveGroupMinCover(value) {
		groupMinCover = normalizeGroupMinCover(value);
		GM_setValue('groupMinCover', groupMinCover);
		return groupMinCover;
	}

	function configureGroupMinCover() {
		const next = prompt(
			'Nombre minimum de couverts pour considérer une réservation comme groupe:',
			String(groupMinCover || DEFAULT_GROUP_MIN_COVER)
		);

		if (next === null) {
			return;
		}

		const n = Number(next);
		if (!Number.isFinite(n) || n < 1) {
			alert('Valeur invalide. Mets un nombre entier de couverts, minimum 1.');
			return;
		}

		const saved = saveGroupMinCover(n);
		alert('Seuil groupe sauvegardé: ' + saved + ' couvert(s). Recharge la vue groupes pour appliquer les changements.');
	}

	function resetGroupMinCover() {
		const ok = confirm('Réinitialiser le seuil groupe à ' + DEFAULT_GROUP_MIN_COVER + ' couverts ?');
		if (!ok) return;

		const saved = saveGroupMinCover(DEFAULT_GROUP_MIN_COVER);
		alert('Seuil groupe réinitialisé: ' + saved + ' couvert(s). Recharge la vue groupes pour appliquer les changements.');
	}

	function registerSettingsMenu() {
		if (typeof GM_registerMenuCommand !== 'function') {
			return;
		}

		GM_registerMenuCommand('Configurer les salles', configureDiningAreaRules);
		GM_registerMenuCommand('Réinitialiser les salles', resetDiningAreaRules);
		GM_registerMenuCommand('Configurer le seuil groupe', configureGroupMinCover);
		GM_registerMenuCommand('Réinitialiser le seuil groupe', resetGroupMinCover);
		GM_registerMenuCommand('Configurer le rechargement auto', configureAutoRefreshInterval);
		GM_registerMenuCommand('Réinitialiser le rechargement auto', resetAutoRefreshInterval);
	}

	function getDiningAreaFromTableNumber(n) {
		const rules = getDiningAreaRules();

		for (const rule of rules) {
			if (!rule || !rule.label) continue;

			if (Array.isArray(rule.numbers) && rule.numbers.includes(n)) {
				return rule.label;
			}

			if (Array.isArray(rule.ranges)) {
				const match = rule.ranges.some(range => {
					if (!Array.isArray(range) || range.length < 2) return false;

					const from = Number(range[0]);
					const to = Number(range[1]);

					return Number.isFinite(from) && Number.isFinite(to) && n >= from && n <= to;
				});

				if (match) {
					return rule.label;
				}
			}
		}

		return null;
	}

	function getDiningAreasFromTables(tables) {
		if (!tables) return '';

		const source = Array.isArray(tables)
			? tables
			: String(tables).split(/[^0-9]+/).filter(Boolean);

		const areaOrder = getDiningAreaRules()
			.map(rule => rule && rule.label)
			.filter(Boolean);

		const areas = new Set();
		source.forEach(tableName => {
			const tableNumber = getTableNumber(tableName);
			if (tableNumber === null) return;

			const area = getDiningAreaFromTableNumber(tableNumber);
			if (area) areas.add(area);
		});

		return areaOrder.filter(area => areas.has(area)).join(', ');
	}

	function pickTranslationValue(translations) {
		if (!Array.isArray(translations) || !translations.length) return '';

		const preferred = translations.find(t => t && t.locale === 'fr_FR' && t.value);
		if (preferred) return preferred.value;

		const fallback = translations.find(t => t && t.value);
		return fallback ? fallback.value : '';
	}

	function getDefaultSectionName(type) {
		const t = String(type || '').toLowerCase();

		if (t === 'starter') return 'Entrée';
		if (t === 'main') return 'Plat';
		if (t === 'dessert') return 'Dessert';
		if (t === 'drink' || t === 'drinks') return 'Boissons';

		return 'Menu';
	}

	function normalizePresetMenu(menu) {
		if (!menu) {
			return {
				price: null,
				note: '',
				sections: []
			};
		}

		const sections = Array.isArray(menu.sections)
			? menu.sections.map(section => {
				const title = pickTranslationValue(section && section.name)
					|| getDefaultSectionName(section && section.type);

				const items = Array.isArray(section && section.items)
					? section.items
						.map(item => pickTranslationValue(item && item.name))
						.filter(Boolean)
					: [];

				return { title, items };
			}).filter(section => section.items.length > 0)
			: [];

		return {
			price: menu.price !== null && menu.price !== undefined && menu.price !== '' ? menu.price : null,
			note: menu.note || '',
			sections
		};
	}

	function closeGroupMenuModal() {
		const backdrop = document.getElementById('bk-menu-modal-backdrop');
		if (backdrop) {
			backdrop.style.display = 'none';
		}
	}

	function openGroupMenuModal(groupId) {
		const group = groupData.find(item => String(item.id) === String(groupId));
		if (!group) return;

		const backdrop = document.getElementById('bk-menu-modal-backdrop');
		const titleEl = document.getElementById('bk-menu-modal-title');
		const contactEl = document.getElementById('bk-menu-modal-contact');
		const subtitleEl = document.getElementById('bk-menu-modal-subtitle');
		const bodyEl = document.getElementById('bk-menu-modal-body');

		if (!backdrop || !titleEl || !contactEl || !subtitleEl || !bodyEl) return;

		const menu = group.presetMenu || normalizePresetMenu(null);
		const timeLabel = formatTime(group.time);
		const dateLabel = group.time ? formatDateHuman(group.time) : group.dayId;
		const serviceLabel = group.service === 'lunch' ? 'Midi' : 'Soir';
		const covers = group.covers || 0;
		const customer = group.customer || '?';
		const phone = group.phone || '';
		const email = group.email || '';

		titleEl.textContent = 'Menu groupe · ' + customer;

		let contactHtml = '';
		if (phone) {
			contactHtml += '<a class="bk-menu-modal-contact-item" href="tel:' + escapeHtml(phone) + '">☎ ' + escapeHtml(phone) + '</a>';
		}
		if (email) {
			contactHtml += '<a class="bk-menu-modal-contact-item" href="mailto:' + escapeHtml(email) + '">✉ ' + escapeHtml(email) + '</a>';
		}
		if (!contactHtml) {
			contactHtml = '<span class="bk-menu-modal-contact-item">Aucun téléphone ou email disponible</span>';
		}
		contactEl.innerHTML = contactHtml;

		subtitleEl.textContent = `${dateLabel} · ${timeLabel} · ${serviceLabel} · ${covers} couverts`;

		let html = '';

		const hasMenuPrice = menu.price !== null && menu.price !== undefined && menu.price !== '';
		if (hasMenuPrice) {
			html += '<div class="bk-menu-note"><strong>Prix:</strong> ' + escapeHtml(formatPriceChf(menu.price)) + '</div>';
		}

		if (menu.note) {
			html += '<div class="bk-menu-note"><strong>Note menu:</strong> ' + escapeHtml(menu.note) + '</div>';
		}

		if (!menu.sections.length) {
			if (group.groupNeedsMenu) {
				html += '<div class="bk-menu-note" style="border-color:#ef4444;background:rgba(127,29,29,0.38);color:#fecaca;"><strong>Attention:</strong> aucun menu groupe n’a encore été choisi pour cette réservation.</div>';
			} else {
				html += '<div class="bk-empty">Aucun détail de menu disponible.</div>';
			}
		} else {
			menu.sections.forEach(section => {
				html += '<div class="bk-menu-section">';
				html += '<div class="bk-menu-section-title">' + escapeHtml(section.title || 'Menu') + '</div>';
				html += '<div class="bk-menu-items">';
				section.items.forEach(item => {
					html += '<div class="bk-menu-item">• ' + escapeHtml(item) + '</div>';
				});
				html += '</div>';
				html += '</div>';
			});
		}

		bodyEl.innerHTML = html;
		backdrop.style.display = 'flex';
	}

	function createUi() {
		if (!document.getElementById('bk-toggle-btn')) {
			const btn = document.createElement('button');
			btn.id = 'bk-toggle-btn';
			btn.textContent = 'Affichage cuisine';
			btn.addEventListener('click', () => setOverlayVisible(true));
			document.body.appendChild(btn);
		}

		if (!document.getElementById('bk-overlay')) {
			const overlay = document.createElement('div');
			overlay.id = 'bk-overlay';
			overlay.innerHTML = `
				<div id="bk-container">
					<div id="bk-header">
						<div id="bk-header-left">
							<div id="bk-header-dot"></div>
							<div>
								<div id="bk-header-title">Écran cuisine</div>
								<div id="bk-header-subtitle"></div>
								<div id="bk-summary"></div>
							</div>
						</div>
						<div id="bk-header-right">
							<button id="bk-groups-btn">Groupes</button>
							<div id="bk-service-tabs">
								<button class="bk-service-tab bk-service-tab-active" data-service="lunch">Midi</button>
								<button class="bk-service-tab" data-service="dinner">Soir</button>
							</div>
							<div id="bk-header-buttons">
								<button id="bk-day-toggle-btn">Demain</button>
								<div id="bk-date-wrapper">
									<span id="bk-date-icon">📅</span>
									<input id="bk-date-input" type="date">
								</div>
								<button id="bk-refresh-btn">Recharger</button>
								<button id="bk-close-btn">Fermer</button>
							</div>
						</div>
					</div>
					<div id="bk-body">
						<div id="bk-top-row">
							<div id="bk-last-refresh">Dernière mise à jour : -</div>
							<div id="bk-error"></div>
						</div>
						<div id="bk-columns">
							<div class="bk-column" data-status="to_arrive">
								<div class="bk-column-header">
									<div class="bk-column-title">À venir</div>
									<div class="bk-column-count" id="bk-count-to_arrive">0</div>
								</div>
								<div class="bk-column-body" id="bk-list-to_arrive"></div>
							</div>
							<div class="bk-column" data-status="on_site">
								<div class="bk-column-header">
									<div class="bk-column-title">En salle</div>
									<div class="bk-column-count" id="bk-count-on_site">0</div>
								</div>
								<div class="bk-column-body" id="bk-list-on_site"></div>
							</div>
							<!--<div class="bk-column" data-status="finished">
								<div class="bk-column-header">
									<div class="bk-column-title">Terminé</div>
									<div class="bk-column-count" id="bk-count-finished">0</div>
								</div>
								<div class="bk-column-body" id="bk-list-finished"></div>
							</div>-->
						</div>
						<div id="bk-groups-panel"></div>
					</div>
				</div>
				<div id="bk-menu-modal-backdrop">
					<div id="bk-menu-modal">
						<div id="bk-menu-modal-header">
							<div>
								<div id="bk-menu-modal-title">Menu groupe</div>
								<div id="bk-menu-modal-contact"></div>
								<div id="bk-menu-modal-subtitle"></div>
							</div>
							<button id="bk-menu-modal-close">Fermer</button>
						</div>
						<div id="bk-menu-modal-body"></div>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);

			document.getElementById('bk-close-btn').addEventListener('click', () => setOverlayVisible(false));
			document.getElementById('bk-refresh-btn').addEventListener('click', () => fetchAndRender(true));

			const menuModalBackdrop = document.getElementById('bk-menu-modal-backdrop');
			const menuModalClose = document.getElementById('bk-menu-modal-close');

			if (menuModalBackdrop) {
				menuModalBackdrop.addEventListener('click', event => {
					if (event.target === menuModalBackdrop) {
						closeGroupMenuModal();
					}
				});
			}

			if (menuModalClose) {
				menuModalClose.addEventListener('click', () => closeGroupMenuModal());
			}

			const dayBtn = document.getElementById('bk-day-toggle-btn');
			const dateInput = document.getElementById('bk-date-input');
			const groupsBtn = document.getElementById('bk-groups-btn');

			let today = new Date();
			let yyyy = today.getFullYear();
			let mm = String(today.getMonth() + 1).padStart(2, '0');
			let dd = String(today.getDate()).padStart(2, '0');

			if (dateInput) {
				dateInput.value = `${yyyy}-${mm}-${dd}`;

				dateInput.addEventListener('change', () => {
					today = new Date();
					yyyy = today.getFullYear();
					mm = String(today.getMonth() + 1).padStart(2, '0');
					dd = String(today.getDate()).padStart(2, '0');
					const value = dateInput.value;
					if (!value) {
						dateOffsetDays = 0;
						dateInput.value = `${yyyy}-${mm}-${dd}`;

						currentDate = null;
						if (dayBtn) dayBtn.textContent = 'Demain';
						fetchAndRender(true);
						return;
					}

					const parts = value.split('-');
					if (parts.length !== 3) return;

					const year = Number(parts[0]);
					const month = Number(parts[1]);
					const day = Number(parts[2]);

					const chosen = new Date(year, month - 1, day);
					if (isNaN(chosen.getTime())) return;

					chosen.setHours(0, 0, 0, 0);
					currentDate = chosen;

					const base = new Date();
					base.setHours(0, 0, 0, 0);
					const diffMs = chosen.getTime() - base.getTime();
					dateOffsetDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

					if (dateOffsetDays === 0) {
						currentDate = null;
						if (dayBtn) dayBtn.textContent = 'Demain';
					} else {
						if (dayBtn) dayBtn.textContent = 'Aujourd’hui';
					}

					fetchAndRender(true);
				});
			}

			if (dayBtn) {
				dayBtn.addEventListener('click', () => {
					currentDate = null;
					if (dateInput) {
						today = new Date();
						if (dateOffsetDays === 0) {
							today.setDate(today.getDate() + 1);
						}
						yyyy = today.getFullYear();
						mm = String(today.getMonth() + 1).padStart(2, '0');
						dd = String(today.getDate()).padStart(2, '0');
						dateInput.value = `${yyyy}-${mm}-${dd}`;
					}
					if (dateOffsetDays === 0) {
						dateOffsetDays = 1;
						dayBtn.textContent = 'Aujourd’hui';
					} else {
						dateOffsetDays = 0;
						dayBtn.textContent = 'Demain';
					}
					fetchAndRender(true);
				});
			}

			if (groupsBtn) {
				groupsBtn.addEventListener('click', () => {
					groupsViewActive = !groupsViewActive;
					updateServiceTabs();
					if (groupsViewActive) {
						fetchAndRenderGroups(true);
					} else {
						renderReservations();
					}
				});
			}

			Array.from(document.querySelectorAll('.bk-service-tab')).forEach(btn => {
				btn.addEventListener('click', () => {
					const service = btn.getAttribute('data-service');
					if (!service) return;
					selectedService = service;
					groupsViewActive = false;
					updateServiceTabs();
					renderReservations();
				});
			});
		}
	}

	function setOverlayVisible(visible) {
		const overlay = document.getElementById('bk-overlay');
		if (!overlay) return;

		if (visible) {
			overlay.style.display = 'flex';
			document.getElementById('bk-toggle-btn').style.display = 'none';
			if (!autoRefreshId) {
				selectServiceForCurrentTime();
				fetchAndRender(true);
				autoRefreshId = setInterval(() => fetchAndRender(false), autoRefreshInterval);
			}
		} else {
			closeGroupMenuModal();
			overlay.style.display = 'none';
			document.getElementById('bk-toggle-btn').style.display = 'block';
			if (autoRefreshId) {
				clearInterval(autoRefreshId);
				autoRefreshId = null;
			}
		}
	}

	function updateServiceTabs() {
		Array.from(document.querySelectorAll('.bk-service-tab')).forEach(btn => {
			const s = btn.getAttribute('data-service');
			if (s === selectedService) {
				btn.classList.add('bk-service-tab-active');
			} else {
				btn.classList.remove('bk-service-tab-active');
			}
		});

		const columnsEl = document.getElementById('bk-columns');
		const groupsEl = document.getElementById('bk-groups-panel');

		const groupsBtn = document.getElementById('bk-groups-btn');
		if (groupsBtn) {
			groupsBtn.classList.toggle('bk-groups-active', groupsViewActive);
		}

		if (columnsEl) {
			columnsEl.style.display = groupsViewActive ? 'none' : 'grid';
		}
		if (groupsEl) {
			groupsEl.style.display = groupsViewActive ? 'flex' : 'none';
		}
	}


	function buildDayReservationsQuery() {
		return `
			query dayReservations($restaurantUuid: String!, $dayId: String!) {
				dayReservations(restaurantUuid: $restaurantUuid, dayId: $dayId) {
					id
					status
					mealDate
					seatingTime
					partySize
					customerNote
					restaurantNote
					offerSnapshot {
						name
					}
					customGroupPresetMenu {
						price
						note
						sections {
							type
							name {
								locale
								value
							}
							items {
								name {
									locale
									value
								}
							}
						}
					}
					occasions,
					customer {
						firstName
						lastName
						phone
						email
						isVip
						favFood
						allergiesAndIntolerances
                        dietaryRestrictions
					}
					tables {
						items { name }
					}
					serviceInstance {
						service { name }
					}
				}
			}
		`;
	}

	async function fetchDayReservations(restaurantUuid, dayId, token) {
		const headers = {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'x-app-name': 'tfm-front',
		};

		if (token) {
			headers['Authorization'] = 'Bearer ' + token;
		}

		const res = await fetch(GRAPHQL_URL, {
			method: 'POST',
			credentials: 'include',
			headers,
			body: JSON.stringify({
				query: buildDayReservationsQuery(),
				variables: { restaurantUuid, dayId }
			})
		});

		if (!res.ok) {
			const err = new Error('Erreur API GraphQL: HTTP ' + res.status);
			err.userMessage = err.message;
			throw err;
		}

		const json = await res.json();
		if (json.errors && json.errors.length) {
			const first = json.errors[0];
			const err = new Error(first.message || JSON.stringify(json.errors));
			err.code = first.extensions && first.extensions.code;
			err.userMessage = 'Erreur GraphQL: ' + err.message;
			throw err;
		}

		return (json.data && json.data.dayReservations) || [];
	}

	async function fetchAndRender(showLoading) {
		if (groupsViewActive) {
			await fetchAndRenderGroups(showLoading);
			return;
		}

		setStatus('loading');
		const errorEl = document.getElementById('bk-error');
		if (errorEl) errorEl.textContent = '';

		const refreshBtn = document.getElementById('bk-refresh-btn');
		if (refreshBtn) {
			if (!refreshBtn.dataset.originalText) {
				refreshBtn.dataset.originalText = refreshBtn.textContent;
			}
			refreshBtn.disabled = true;
			refreshBtn.textContent = 'Rechargement…';
			refreshBtn.classList.add('bk-refresh-loading');
		}

		const base = new Date();
		base.setHours(0, 0, 0, 0);

		let effective;
		if (currentDate && !isNaN(currentDate.getTime())) {
			effective = new Date(currentDate);
		} else {
			effective = new Date(base);
			effective.setDate(base.getDate() + dateOffsetDays);
		}

		const year  = effective.getFullYear();
		const month = String(effective.getMonth() + 1).padStart(2, '0');
		const day   = String(effective.getDate()).padStart(2, '0');
		const dayId = `${year}-${month}-${day}`;

		const dateInput = document.getElementById('bk-date-input');
		if (dateInput) {
			dateInput.value = `${year}-${month}-${day}`;
		}

		const headerSubtitle = document.getElementById('bk-header-subtitle');
		if (headerSubtitle) {
			let text = 'Service du ' + formatDateHuman(effective);
			if (!currentDate && dateOffsetDays === 1) {
				text += ' (demain)';
			}
			headerSubtitle.textContent = text;
		}

		if (showLoading) {
			//['on_site', 'to_arrive', 'finished'].forEach(st => {
			['on_site', 'to_arrive'].forEach(st => {
				const body = document.getElementById('bk-list-' + st);
				if (body) body.innerHTML = '<div class="bk-empty">Chargement...</div>';
			});
		}

		const query = buildDayReservationsQuery();

		const restaurantUuid = getRestaurantUuid();
		if (!restaurantUuid) {
			if (errorEl) {
				setStatus('error');
				errorEl.textContent = 'Impossible de trouver le restaurant UUID (token TheFork incomplet).';
			}
			return;
		}

		const variables = {
			restaurantUuid,
			dayId
		};

		try {
			const token = getTheForkToken();

			const headers = {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
				'x-app-name': 'tfm-front',
			};

			if (token) {
				headers['Authorization'] = 'Bearer ' + token;
			}

			const res = await fetch(GRAPHQL_URL, {
				method: 'POST',
				credentials: 'include',
				headers,
				body: JSON.stringify({ query, variables })
			});

			if (!res.ok) {
				if (errorEl) {
					setStatus('error');
					errorEl.textContent = 'Erreur API GraphQL: HTTP ' + res.status;
				}
				return;
			}

			const json = await res.json();
			if (json.errors && json.errors.length) {
				setStatus('error');
				const first = json.errors[0];
				const code = first.extensions && first.extensions.code;

				if (code === 'UNAUTHENTICATED') {
					if (errorEl) {
						errorEl.textContent = 'Session TheFork expirée ou invalide. Recharge la page et reconnecte-toi.';
					}
					if (autoRefreshId) {
						clearInterval(autoRefreshId);
						autoRefreshId = null;
					}
					return;
				}

				if (errorEl) {
					errorEl.textContent = 'Erreur GraphQL: ' + (first.message || JSON.stringify(json.errors));
				}
				return;
			}

			const reservations = (json.data && json.data.dayReservations) || [];
			normalizedData = normalizeReservations(reservations);

			renderReservations();

			const lastRefreshEl = document.getElementById('bk-last-refresh');
			if (lastRefreshEl) {
				lastRefreshEl.textContent = 'Dernière mise à jour : ' + new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			}
			setStatus('ok');
		} catch (e) {
			if (errorEl) {
				setStatus('error');
				errorEl.textContent = 'Erreur réseau: ' + e;
			}
		} finally {
			if (refreshBtn) {
				refreshBtn.disabled = false;
				if (refreshBtn.dataset.originalText) {
					refreshBtn.textContent = refreshBtn.dataset.originalText;
				}
				refreshBtn.classList.remove('bk-refresh-loading');
			}
		}
	}


	async function fetchAndRenderGroups(showLoading) {
		setStatus('loading');
		const errorEl = document.getElementById('bk-error');
		if (errorEl) errorEl.textContent = '';

		const refreshBtn = document.getElementById('bk-refresh-btn');
		if (refreshBtn) {
			if (!refreshBtn.dataset.originalText) {
				refreshBtn.dataset.originalText = refreshBtn.textContent;
			}
			refreshBtn.disabled = true;
			refreshBtn.textContent = 'Rechargement…';
			refreshBtn.classList.add('bk-refresh-loading');
		}

		const groupsPanel = document.getElementById('bk-groups-panel');
		if (showLoading && groupsPanel) {
			groupsPanel.innerHTML = '<div class="bk-empty">Recherche des groupes sur les 10 prochains jours...</div>';
		}

		const base = new Date();
		base.setHours(0, 0, 0, 0);

		const headerSubtitle = document.getElementById('bk-header-subtitle');
		if (headerSubtitle) {
			headerSubtitle.textContent = `Groupes · menu preset ou ${groupMinCover}+ couverts · aujourd’hui + 10 prochains jours`;
		}

		const restaurantUuid = getRestaurantUuid();
		if (!restaurantUuid) {
			if (errorEl) {
				setStatus('error');
				errorEl.textContent = 'Impossible de trouver le restaurant UUID (token TheFork incomplet).';
			}
			return;
		}

		try {
			const token = getTheForkToken();
			const dayIds = [];

			for (let offset = 0; offset <= 10; offset++) {
				dayIds.push(formatDateId(addDays(base, offset)));
			}

			const results = await Promise.all(dayIds.map(async dayId => {
				const reservations = await fetchDayReservations(restaurantUuid, dayId, token);
				reservations.forEach(r => {
					if (!r) return;
					r.__dayId = dayId;
				});
				return reservations;
			}));

			const allReservations = results.flat();
			groupData = normalizeGroupReservations(allReservations);
			renderGroups();

			const lastRefreshEl = document.getElementById('bk-last-refresh');
			if (lastRefreshEl) {
				lastRefreshEl.textContent = 'Dernière mise à jour : ' + new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			}
			setStatus('ok');
		} catch (e) {
			if (errorEl) {
				setStatus('error');
				if (e.code === 'UNAUTHENTICATED') {
					errorEl.textContent = 'Session TheFork expirée ou invalide. Recharge la page et reconnecte-toi.';
					if (autoRefreshId) {
						clearInterval(autoRefreshId);
						autoRefreshId = null;
					}
				} else {
					errorEl.textContent = e.userMessage || ('Erreur réseau: ' + e);
				}
			}
		} finally {
			if (refreshBtn) {
				refreshBtn.disabled = false;
				if (refreshBtn.dataset.originalText) {
					refreshBtn.textContent = refreshBtn.dataset.originalText;
				}
				refreshBtn.classList.remove('bk-refresh-loading');
			}
		}
	}

	function normalizeGroupReservations(resList) {
		const groups = [];

		(resList || []).forEach(r => {
			if (!r) return;

			const rawStatus = (r.status || '').toUpperCase();
			if (rawStatus.includes('CANCEL')) {
				return;
			}

			const hasPresetMenu = !!r.customGroupPresetMenu;
			const covers = r.partySize || 0;
			const isLargeGroup = covers >= groupMinCover;

			if (!hasPresetMenu && !isLargeGroup) {
				return;
			}

			const normalized = normalizeReservations([r]);
			const service = mapServiceFromReservation(r);
			const source = service === 'lunch' ? normalized.lunch : normalized.dinner;
			const entry = source && source[0] ? source[0] : null;

			if (!entry) return;

			entry.dayId = r.__dayId || formatDateId(entry.time);
			entry.service = service;
			entry.hasPresetMenu = hasPresetMenu;
			entry.groupNeedsMenu = !hasPresetMenu && isLargeGroup;
			entry.menuPrice = hasPresetMenu && r.customGroupPresetMenu.price !== null && r.customGroupPresetMenu.price !== undefined && r.customGroupPresetMenu.price !== '' ? r.customGroupPresetMenu.price : null;
			entry.presetMenu = normalizePresetMenu(r.customGroupPresetMenu);

			groups.push(entry);
		});

		groups.sort((a, b) => {
			const da = a.time || a.dayId || '';
			const db = b.time || b.dayId || '';
			return da.localeCompare(db);
		});

		return groups;
	}

	function renderGroups() {
		const groupsPanel = document.getElementById('bk-groups-panel');
		const summaryEl = document.getElementById('bk-summary');
		if (!groupsPanel) return;

		const totalCovers = groupData.reduce((sum, r) => sum + (r.covers || 0), 0);

		if (summaryEl) {
			summaryEl.textContent = `Groupes · ${groupData.length} réservations / ${totalCovers} couverts`;
		}

		if (!groupData.length) {
			groupsPanel.innerHTML = `<div class="bk-empty">Aucun groupe avec menu ou réservation de ${groupMinCover}+ couverts sur les 10 prochains jours.</div>`;
			return;
		}

		groupsPanel.innerHTML = '';
		const frag = document.createDocumentFragment();

		groupData.forEach(r => {
			const timeLabel = formatTime(r.time);
			const dateLabel = r.time ? formatDateHuman(r.time) : r.dayId;
			const serviceLabel = r.service === 'lunch' ? 'Midi' : 'Soir';
			const covers = r.covers || 0;
			const customer = r.customer || '?';
			const comment = r.comment || '';
			const offer = r.offer || '';
			const favFood = r.favFood || '';
			const note = r.note || '';
			const diet = r.diet || '';
			const allergies = r.allergies || '';
			const tables = r.tables || '';
			const diningAreas = r.diningAreas || getDiningAreasFromTables(tables);
			const occasions = r.occasions || '';
			const isVip = !!r.isVip;
			const menuPrice = r.menuPrice;
			const hasMenuPrice = menuPrice !== null && menuPrice !== undefined && menuPrice !== '';
			const hasPresetMenu = !!r.hasPresetMenu;
			const groupNeedsMenu = !!r.groupNeedsMenu;

			const div = document.createElement('div');
			div.className = 'bk-group-card' + (groupNeedsMenu ? ' bk-group-missing-menu' : '');
			div.setAttribute('data-id', r.id);
			div.setAttribute('role', 'button');
			div.setAttribute('tabindex', '0');
			div.title = hasPresetMenu
				? 'Cliquer pour afficher le menu du groupe'
				: 'Aucun menu choisi pour ce groupe';
			div.addEventListener('click', () => openGroupMenuModal(r.id));
			div.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					openGroupMenuModal(r.id);
				}
			});

			let html =
				'<div class="bk-group-card-header">' +
				'<div>' +
				'<div class="bk-group-date">' + escapeHtml(dateLabel) + ' · ' + escapeHtml(timeLabel) + '</div>' +
				'<div class="bk-group-meta">' +
				'<span class="bk-group-service">' + escapeHtml(serviceLabel) + '</span>' +
				'<span>' + covers + ' couverts</span>' +
				'<span>Salle: ' + escapeHtml(diningAreas || '?') + '</span>' +
				'</div>' +
				'</div>' +
				(
					groupNeedsMenu
						? '<div class="bk-group-alert-badge">Menu à choisir</div>'
						: '<div class="bk-card-covers">Menu groupe' + (hasMenuPrice ? ' · ' + escapeHtml(formatPriceChf(menuPrice)) : '') + '</div>'
				) +
				'</div>' +
				'<div class="bk-card-main">' +
				'<div class="bk-card-main-col">' +
				'<div class="bk-card-label">Client</div>' +
				'<div class="bk-card-value">' +
				escapeHtml(customer || '?') +
				(isVip ? ' <span class="bk-vip-badge">VIP</span>' : '') +
				'</div>' +
				'</div>' +
				'</div>';

			let hasNotes = !!(note || comment || allergies || diet || offer || favFood || occasions);
			if (hasNotes) {
				html += '<div class="bk-notes">';
				if (occasions) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Occasions:</span>' +
						'<span>' + escapeHtml(occasions) + '</span>' +
						'</div>';
				}
				if (allergies) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Allergies:</span>' +
						'<span>' + escapeHtml(allergies) + '</span>' +
						'</div>';
				}
				if (diet) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Régime:</span>' +
						'<span>' + escapeHtml(diet) + '</span>' +
						'</div>';
				}
				if (favFood) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Préférences:</span>' +
						'<span>' + escapeHtml(favFood) + '</span>' +
						'</div>';
				}
				if (offer) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Offre:</span>' +
						'<span>' + escapeHtml(offer) + '</span>' +
						'</div>';
				}
				if (note) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Note restau:</span>' +
						'<span>' + escapeHtml(note) + '</span>' +
						'</div>';
				}
				if (comment) {
					html +=
						'<div class="bk-note-line">' +
						'<span class="bk-note-label">Commentaire client:</span>' +
						'<span>' + escapeHtml(comment) + '</span>' +
						'</div>';
				}
				html += '</div>';
			}

			div.innerHTML = html;
			frag.appendChild(div);
		});

		groupsPanel.appendChild(frag);
	}

	function normalizeReservations(resList) {
		const lunch = [];
		const dinner = [];

		(resList || []).forEach(r => {
			if (!r) return;

			const rawStatus = (r.status || '').toUpperCase();
			if (rawStatus.includes('CANCEL')) {
				return;
			}

			const service = mapServiceFromReservation(r);
			const time = r.mealDate || null;
			const covers = r.partySize || 0;
			const statusKey = mapStatusForKitchen(r.status, r.seatingTime);

			//if (statusKey === 'finished' || statusKey === 'unknown') return;
			if (statusKey === 'unknown') return;

			const customerFirst = (r.customer && r.customer.firstName) || '';
			const customerLast = (r.customer && r.customer.lastName) || '';
			const customerName = (customerFirst + ' ' + customerLast).trim() || 'Passage';
			const customerPhone = (r.customer && (r.customer.phoneNumber || r.customer.phone)) || '';
			const customerEmail = (r.customer && r.customer.email) || '';

			let allergies = '';
			if (r.customer && r.customer.allergiesAndIntolerances) {
				const a = r.customer.allergiesAndIntolerances;
				if (Array.isArray(a)) {
					allergies = a.join(', ');
				} else {
					allergies = String(a);
				}
			}

			let diet = '';
			if (r.customer && r.customer.dietaryRestrictions) {
				const a = r.customer.dietaryRestrictions;
				if (Array.isArray(a)) {
					diet = a.join(', ');
				} else {
					diet = String(a);
				}
			}

			let tables = '';
			if (r.tables && Array.isArray(r.tables.items)) {
				const names = r.tables.items
					.map(t => t && t.name)
					.filter(Boolean)
					.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
				tables = names.join('-');
			}

			let occasions = '';
			if (Array.isArray(r.occasions) && r.occasions.length > 0) {
				occasions = r.occasions.join(', ');
			}

			const entry = {
				id: r.id || null,
				time,
				covers,
				status: statusKey,
				comment: r.customerNote || '',
				note: r.restaurantNote || '',
				offer: r.offerSnapshot && r.offerSnapshot.name ? r.offerSnapshot.name : '',
				favFood: r.customer && r.customer.favFood ? r.customer.favFood : '',
				menu: r.customGroupPresetMenu ? 'Oui' : '',
				phone: customerPhone,
				email: customerEmail,
				tables,
				diningAreas: getDiningAreasFromTables(tables),
				occasions: occasions,
				customer: customerName,
				allergies: allergies,
				diet: diet,
				isVip: !!(r.customer && r.customer.isVip),
			};

			if (service === 'lunch') {
				lunch.push(entry);
			} else {
				dinner.push(entry);
			}
		});

		const sortByTime = (a, b) => (a.time || '').localeCompare(b.time || '');
		lunch.sort(sortByTime);
		dinner.sort(sortByTime);

		return { lunch, dinner };
	}

	function renderReservations() {
		const data = normalizedData[selectedService] || [];

		const groups = {
			on_site: [],
			to_arrive: [],
			//finished: []
		};

		const coversByStatus = {
			on_site: 0,
			to_arrive: 0,
			finished: 0
		};

		let totalCovers = 0;
		data.forEach(r => {
			if (!r) return;

			const covers = r.covers || 0;
			let status = r.status;

			if (!status || !groups[status]) {
				status = 'to_arrive';
			}

			groups[status].push(r);
			coversByStatus[status] += covers;
			totalCovers += covers;
		});

		const totalRes = data.length;
		const summaryEl = document.getElementById('bk-summary');
		if (summaryEl) {
			const label = selectedService === 'lunch' ? 'Midi' : 'Soir';
			summaryEl.textContent = `${label} · ${totalRes} réservations / ${totalCovers} couverts`;
		}

		//['on_site', 'to_arrive', 'finished].forEach(statusKey => {
		['on_site', 'to_arrive'].forEach(statusKey => {
			const listEl = document.getElementById('bk-list-' + statusKey);
			const countEl = document.getElementById('bk-count-' + statusKey);
			if (!listEl || !countEl) return;

			const arr = groups[statusKey];
			const coversForStatus = coversByStatus[statusKey] || 0;
			countEl.textContent = `${arr.length} résa / ${coversForStatus} couverts`;

			if (!arr.length) {
				listEl.innerHTML = '<div class="bk-empty">Aucune réservation.</div>';
				return;
			}

			listEl.innerHTML = '';
			const frag = document.createDocumentFragment();

			arr.forEach(r => {
				if (!r || r.status === 'finished') return;
				const timeLabel = formatTime(r.time);
				const covers = r.covers || 0;
				const customer = r.customer || '?';
				const comment = r.comment || '';
				const offer = r.offer || '';
				const menu = r.menu || '';
				const favFood = r.favFood || '';
				const note = r.note || '';
				const diet = r.diet || '';
				const allergies = r.allergies || '';
				const tables = r.tables || '';
				const occasions = r.occasions || '';
				const isVip = !!r.isVip;

				const div = document.createElement('div');
				div.className = 'bk-card';
				div.setAttribute('data-id', r.id);

				let html =
					'<div class="bk-card-header">' +
					'<div class="bk-card-time">' + escapeHtml(timeLabel) + '</div>' +
					'<div class="bk-card-covers">' + covers + ' couverts</div>' +
					'</div>' +
					'<div class="bk-card-main">' +
					'<div class="bk-card-main-col">' +
					'<div class="bk-card-label">Client</div>' +
					'<div class="bk-card-value">' +
					escapeHtml(customer || '?') +
					(isVip ? ' <span class="bk-vip-badge">VIP</span>' : '') +
					'</div>' +
					'</div>' +
					'<div class="bk-card-main-col" style="max-width: 40%;">' +
					'<div class="bk-card-label">Table</div>' +
					'<div class="bk-card-value">' + escapeHtml(tables || '?') + '</div>' +
					'</div>' +
					'</div>';

				let hasNotes = !!(note || comment || allergies || diet || menu || offer || favFood || occasions);
				if (hasNotes) {
					html += '<div class="bk-notes">';
					if (occasions) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Occasions:</span>' +
							'<span>' + escapeHtml(occasions) + '</span>' +
							'</div>';
					}
					if (allergies) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Allergies:</span>' +
							'<span>' + escapeHtml(allergies) + '</span>' +
							'</div>';
					}
					if (diet) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Régime:</span>' +
							'<span>' + escapeHtml(diet) + '</span>' +
							'</div>';
					}
					if (favFood) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Préférences:</span>' +
							'<span>' + escapeHtml(favFood) + '</span>' +
							'</div>';
					}
					if (offer) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Offre:</span>' +
							'<span>' + offer + '</span>' +
							'</div>';
					}
					if (menu) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Menu:</span>' +
							'<span>' + menu + '</span>' +
							'</div>';
					}
					if (note) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Note restau:</span>' +
							'<span>' + escapeHtml(note) + '</span>' +
							'</div>';
					}
					if (comment) {
						html +=
							'<div class="bk-note-line">' +
							'<span class="bk-note-label">Commentaire client:</span>' +
							'<span>' + escapeHtml(comment) + '</span>' +
							'</div>';
					}
					html += '</div>';
				}

				div.innerHTML = html;
				frag.appendChild(div);
			});

			listEl.appendChild(frag);
		});
	}

	function init() {
		registerSettingsMenu();

		console.info('%c' + GM_info.script.name + ' %cv' + GM_info.script.version,
			'padding: 5px; border: 1px solid black; border-radius: 6px; background-color: white; color: black; margin-right: 5px;',
			'padding: 5px; border: 1px solid black; border-radius: 6px; background-color: white; color: black;'
		);
		if (!document.body) {
			const obs = new MutationObserver(() => {
				if (document.body) {
					obs.disconnect();
					createUi();
				}
			});
			obs.observe(document.documentElement, { childList: true, subtree: true });
		} else {
			createUi();
		}
	}

	function start() {
		init();
		setInterval(() => {
			try {
				createUi();
			} catch (e) {
				// don't break
			}
		}, 2000);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();
