
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
describe('Kaigi reconnect navigation', () => {
 it('returns to authorized selection without leaking a meeting key, token, or presenter flag', () => {
  let destination;
  const context=vm.createContext({window:{location:{origin:'https://localhost',replace:url=>destination=url}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/RoomClient.js'),'utf8')+';globalThis.Client=RoomClient;',context);
  context.Client.prototype.getReconnectDirectJoinURL.call({getPeerInfoFromLocalStorage:()=>({peer_token:'sensitive',peer_presenter:true}),room_id:'private-meeting'});
  assert.equal(destination,'/login?select=1');
 });
});
