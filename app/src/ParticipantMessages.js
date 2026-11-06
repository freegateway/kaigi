'use strict';

const { randomUUID } = require('node:crypto');
const rooms = new WeakMap();

// Called behind the production session/admission packet middleware.
module.exports = function participantMessages(socket, { getRoom, getPeer, securityEvent, checkXSS, isValidFileName }) {
    const reject = (reason) => securityEvent('socket_event_rejected', socket, reason);
    const context = () => {
        const room = getRoom(socket),
            peer = getPeer(socket);
        if (!room || !peer) return null;
        if (!rooms.has(room)) rooms.set(room, { files: new Map(), snapshots: new Map() });
        return { room, peer, state: rooms.get(room) };
    };
    const object = (data) => data && typeof data === 'object' && !Array.isArray(data);
    const identity = (peer) => ({
        sender_id: socket.id,
        peer_name: peer.peer_name,
        peer_avatar: peer.peer_avatar || false,
    });
    socket.on('fileInfo', (raw) => {
        const ctx = context();
        if (!ctx || !object(raw)) return;
        let data;
        try {
            data = checkXSS(raw);
        } catch {
            securityEvent('socket_event_rejected', socket, 'sanitization_failed');
            return;
        }
        if (!isValidFileName(data.fileName)) return;
        const recipients = [...ctx.room.getPeers().keys()].filter(
            (id) => id !== socket.id && (data.broadcast === true || id === data.peer_id)
        );
        if (!recipients.length) return;
        ctx.state.files.set(socket.id, new Set(recipients));
        for (const id of recipients)
            ctx.room.sendTo(id, 'fileInfo', { ...data, broadcast: data.broadcast === true, ...identity(ctx.peer) });
    });
    socket.on('file', (raw) => {
        const ctx = context();
        if (!ctx || !object(raw)) return;
        if (
            !Buffer.isBuffer(raw.fileData) &&
            !(raw.fileData instanceof ArrayBuffer) &&
            !ArrayBuffer.isView(raw.fileData)
        )
            return reject('file_transfer_denied');
        const recipients = ctx.state.files.get(socket.id);
        if (!recipients) return reject('file_transfer_denied');
        for (const id of recipients) ctx.room.sendTo(id, 'file', { fileData: raw.fileData, sender_id: socket.id });
    });
    socket.on('fileAbort', () => {
        const ctx = context();
        if (!ctx) return;
        for (const id of ctx.state.files.get(socket.id) || []) ctx.room.sendTo(id, 'fileAbort', identity(ctx.peer));
        ctx.state.files.delete(socket.id);
    });
    socket.on('receiveFileAbort', (raw) => {
        const ctx = context();
        if (!ctx || !object(raw)) return;
        const recipients = ctx.state.files.get(raw.peer_id);
        if (!recipients?.delete(socket.id)) return reject('file_transfer_denied');
        // One receiver leaving a broadcast must not abort it for everybody else.
    });
    socket.on('editorChange', (raw) => {
        const ctx = context();
        if (ctx && object(raw) && Array.isArray(raw.ops)) ctx.room.broadCast(socket.id, 'editorChange', raw);
    });
    socket.on('editorActions', (raw) => {
        const ctx = context();
        if (!ctx || !object(raw)) return;
        if (raw.action !== 'clean') return reject('editor_action_denied');
        ctx.room.broadCast(socket.id, 'editorActions', { action: 'clean', peer_name: ctx.peer.peer_name });
    });
    let requested = false;
    socket.on('editorReady', () => {
        const ctx = context();
        if (!ctx || requested) return;
        requested = true;
        const donor = [...ctx.room.getPeers().keys()].find((id) => id !== socket.id);
        if (!donor) return;
        const requestId = randomUUID();
        ctx.state.snapshots.set(socket.id, { requestId, donor, expires: Date.now() + 10000 });
        ctx.room.sendTo(donor, 'editorSnapshotRequest', { requestId });
    });
    socket.on('editorUpdate', (raw) => {
        const ctx = context();
        if (!ctx || !object(raw)) return;
        for (const [target, request] of ctx.state.snapshots) {
            if (request.expires < Date.now()) {
                ctx.state.snapshots.delete(target);
                continue;
            }
            if (request.requestId !== raw.requestId || request.donor !== socket.id) continue;
            ctx.state.snapshots.delete(target);
            if (object(raw.content) && Array.isArray(raw.content.ops) && ctx.room.getPeer(target))
                ctx.room.sendTo(target, 'editorUpdate', raw.content);
            return;
        }
        reject('editor_snapshot_denied');
    });
    socket.on('disconnect', () => {
        const ctx = context();
        if (!ctx) return;
        ctx.state.files.delete(socket.id);
        ctx.state.snapshots.delete(socket.id);
        for (const recipients of ctx.state.files.values()) recipients.delete(socket.id);
        for (const [target, request] of ctx.state.snapshots)
            if (request.donor === socket.id) ctx.state.snapshots.delete(target);
    });
};
