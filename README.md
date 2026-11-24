# echo-webshare-client
Frontend for Echo WebShare

## Screen-share connectivity

Both pages use `site/webrtc.js` to hold ICE candidates until the peer connection is ready. If the stream cannot connect, leave the room and rejoin. If the browser blocks autoplay, select **Play stream**.

The client currently uses STUN only. A TURN relay with short-lived credentials supplied by a backend is still needed for networks that block direct peer connections. Verify screen sharing with a host and viewer on separate networks before relying on it in production.
