'use strict';
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

// Only server-issued filenames can be written, within their original meeting and login session.
module.exports = function recordingCapabilities({ key, expiresIn, rooms, requireSession, allowsRoom, recordingAllowed, enabled }) {
    const issued = new WeakMap();
    async function issue(socket) {
        const room = rooms.get(socket.room_id), session = requireSession(socket.authSessionId);
        if (!enabled || !room?.getPeer(socket.id) || !socket.authenticatedMeeting || !recordingAllowed(socket.room_id) || !(await allowsRoom(session, socket.room_id))) throw Error('Recording not authorized');
        requireSession(session.id);
        if (rooms.get(socket.room_id) !== room || !room.getPeer(socket.id)) throw Error('Recording not authorized');
        if (!issued.has(room)) issued.set(room, new Map());
        const files = issued.get(room);
        for (const [name, state] of files) if (state.exp * 1000 <= Date.now()) files.delete(name);
        if (files.size >= 256) throw Error('Recording limit reached');
        const fileName = `Rec_${randomUUID()}.webm`;
        const token = jwt.sign({ scope: 'rec-upload', roomId: socket.room_id, recordingKey: room.sessionId, fileName, authSessionId: session.id }, key, { algorithm: 'HS256', expiresIn });
        files.set(fileName, { exp: jwt.decode(token).exp, busy: false, finalized: false });
        return { fileName, token };
    }
    function attach(socket) {
        socket.on('getRecUploadToken', async (_data, ack) => {
            if (typeof ack !== 'function') return;
            try { ack(await issue(socket)); } catch { ack({ error: 'Recording not authorized' }); }
        });
    }
    async function authorize(req, res, next) {
        try {
            if (!enabled) throw Error();
            const auth = req.headers.authorization;
            if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw Error();
            const c = jwt.verify(auth.slice(7).trim(), key, { algorithms: ['HS256'] });
            if (c.scope !== 'rec-upload' || typeof c.fileName !== 'string' || c.fileName !== req.query.fileName) throw Error();
            const room = rooms.get(c.roomId), session = requireSession(c.authSessionId);
            if (!room || room.sessionId !== c.recordingKey || !recordingAllowed(c.roomId) || !(await allowsRoom(session, c.roomId))) throw Error();
            requireSession(c.authSessionId);
            if (rooms.get(c.roomId) !== room || room.sessionId !== c.recordingKey) throw Error();
            const file = issued.get(room)?.get(c.fileName);
            if (!file || file.finalized || file.busy) throw Error();
            file.busy = true;
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                file.busy = false;
                if (req.path !== '/recSync' && res.writableFinished && res.statusCode < 300) {
                    file.finalized = true;
                    issued.get(room)?.delete(c.fileName);
                }
            };
            res.once('finish', release);
            res.once('close', release);
            req.recUploadRoomId = c.roomId;
            req.recUploadFileName = c.fileName;
            next();
        } catch { res.status(403).json({ error: 'Recording upload not authorized' }); }
    }
    return { attach, authorize };
};
