Kaigi is [FreeGateway's](https://www.freegateway.org) self-hosted video conferencing system. As with all FreeGateway projects, security is paramount. Video conferencing, however, presents heightened security and privacy risks that demand higher levels of protection. When you enter a video conference and activate your microphone and camera, you need strong assurance that the only people who can hear you, see you and read your messages are those expressly authorized to be in the conference.

Properly executed self-hosting is the basis of a robust security policy and the foundation of an organization's Digital Sovereignty. It gives your organization direct control over the video conferencing service, its accounts and its data. Your organization runs the Kaigi video conferencing system on hardware it controls. Your organization decides who can log in to Kaigi and what meetings they can attend. These three protections are the core of Kaigi's security:

- **Only authorized people can join.** Kaigi does not support ad hoc accounts created by users. Your organization must create authorized user accounts in advance.
- **You control your own participation.** Other attendees cannot turn on your camera or microphone, remove you, or end the meeting for everyone. When you exit a meeting, Kaigi immediately stops capturing your video and audio for that meeting.
- **No tracking by third parties.** Kaigi makes no automatic requests for scripts, fonts or translations from third-party services. Kaigi serves these resources from this site, so outside providers don’t learn about your activity just because you opened a page or joined a meeting.

## Only authorized people can join

Everyone must log in with the username and password from their pre-authorized account. Receiving an invitation or knowing a meeting’s name does not grant access to that meeting.

Kaigi verifies your meeting permissions on the server when you select a meeting, open the pre-meeting page, and join.

Kaigi keeps meeting names and login tokens out of the links it generates, so they aren’t exposed simply by copying a page address or leaving it in your browser history.

## You control your own participation

Meetings do not have moderators or hosts. Another attendee cannot turn on your camera or microphone, admit or remove you, or end the meeting for everyone.

Kaigi also checks who sent chat messages and file transfers instead of trusting the sender name supplied with them. Shared whiteboards are available only while a meeting is live. Draft text annotations stay in your browser until you save them, and chat typing indicators are off unless the site administrator enables them.

The site administrator can disable Kaigi’s built-in recording for specific meetings. However, that does not prevent someone from taking a screenshot, recording with another app, or saving something you share.

## No tracking by third parties

Kaigi serves the resources it needs—such as scripts, fonts, translations, and background effects—from this site. It does not fetch them from third-party servers. Kaigi also removes built-in tracking and remote avatar services, does not send meeting content to external AI or transcription services, and blocks features that would silently load an outside image.

**Why does that matter?** Even a request for something as ordinary as a font can tell an outside service your IP address and when your browser made the request. Depending on the request, it may also reveal which site you were visiting. Serving resources locally from this server avoids those routine disclosures. It also means an outside provider cannot change a script that Kaigi loads live into your meeting, or make part of the interface stop working by taking a resource offline.

This does not mean your browser can never contact another site. If you choose to open an external link, your browser contacts its destination. Likewise, your administrator can explicitly configure Kaigi to contact other services, whether hosted by your organization or third parties. For example, your organization may configure its own OpenLDAP user directory for login or a [TURN](https://en.wikipedia.org/wiki/Traversal_Using_Relays_around_NAT) media relay server that helps participants connect from restrictive networks.

## Sessions expire, and suspicious requests are limited

Logging out ends your session on the Kaigi server. An expired or revoked session cannot be used to rejoin, and reconnecting after a network interruption does not bypass the access checks. The site administrator can configure two optional time limits to control your session and require you to log in again once you reach the limit. One is an inactivity limit that triggers when Kaigi detects no activity from your browser for a specified amount of time (your quiet participation in a meeting does not count as inactivity). The second is a maximum session time limit that is absolute and is never extended by activity.

Kaigi limits repeated login attempts and closes connections that open but fail to finish connecting or authenticating. These measures help keep the service available to legitimate users. Security event logs can record details such as the time, type of event, and connecting IP address, but do not include passwords or login tokens. The organization operating this site sets its own log retention policy.

## What these protections do not cover

Kaigi encrypts connections between your browser and the conferencing server. HTTPS protects web pages and login information, while WebRTC encryption protects audio, video and screen sharing. This protects information in transit, but does not hide meeting content from the conferencing server itself. Kaigi does not provide end-to-end encryption. The organization running the site is responsible for securing that server, keeping it updated, and explaining how it handles data. Other authorized attendees can still see, hear, or copy what you choose to share with them.

For questions about this installation’s privacy practices, contact your site administrator. If you think you’ve found a security flaw, report it privately rather than posting details in a public issue.

## Kaigi integrates with FreeGateway's Kojo Email System

Kaigi can connect to the OpenLDAP user directory used by FreeGateway’s [Kojo](https://www.freegateway.org/projects/kojo) email system. When your organization enables this integration, you can use the same account credentials for email and Kaigi, without needing a separate conferencing password. You still log in to Kaigi: sharing a user directory does not mean that logging in to email automatically logs you in to meetings.

Your organization manages accounts and meeting permissions centrally. It can use directory groups to give different teams access to different meetings. Having an email account does not automatically give someone access to every meeting; Kaigi continues to check each person’s meeting permissions on the server.

Kaigi checks your password with your organization’s user directory and does not keep it for later meeting access. This avoids maintaining a second set of conferencing passwords or sending them to an outside identity provider. Connections to a directory on another system use encrypted, certificate-verified TLS. Kaigi restricts unencrypted directory connections to the same host’s loopback network.

Kojo integration is optional. Kaigi can also use locally managed accounts or another compatible OpenLDAP directory, while retaining its meeting-access checks.
