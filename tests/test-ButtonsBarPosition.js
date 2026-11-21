'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../public/js/RoomClient'), 'utf8');
describe('toolbar layout and saved positions', () => {
	for (const [position, direction, menu, left] of [['horizontal', 'row', 'dropup', '40%'], ['vertical', 'column', 'dropend', '15px']]) {
		it(`places the ${position} toolbar and its menus correctly`, () => {
			const dom = new JSDOM('<div id="bottomButtons"><div class="split-btn"><div class="dropdown"></div></div></div>', { runScripts: 'outside-only' });
			try {
				dom.window.eval(source + ';window.Client=RoomClient;');
				dom.window.bottomButtons = dom.window.document.getElementById('bottomButtons');
				const client = Object.create(dom.window.Client.prototype);
				client.getPinnedSidePanelWidth = () => 20;
				client.changeBtnsBarPosition(position);
				assert.equal(dom.window.document.documentElement.style.getPropertyValue('--bottom-btns-flex-direction'), direction);
				assert.equal(dom.window.document.documentElement.style.getPropertyValue('--bottom-btns-left'), left);
				assert(dom.window.document.querySelector('.dropdown').classList.contains(menu));
			} finally { dom.window.close(); }
		});
	}
	it('retains bottom/side meanings for stored selection indexes', () => {
		const dom = new JSDOM(fs.readFileSync(require.resolve('../public/views/Room.html'), 'utf8'));
		const select = dom.window.document.getElementById('BtnsBarPosition');
		assert.equal(select.options[0].value, 'horizontal');
		assert.equal(select.options[1].value, 'vertical');
		dom.window.close();
	});
});
