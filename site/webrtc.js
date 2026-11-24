class ScreenSharePeers {
  constructor(config, send, onFailure) {
    this.config = config;
    this.send = send;
    this.onFailure = onFailure;
    this.connections = new Map();
    this.pendingIce = new Map();
  }

  create(peerId) {
    this.closeConnection(peerId);
    const pc = new RTCPeerConnection(this.config);
    this.connections.set(peerId, pc);

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !this.isCurrent(peerId, pc)) return;
      if (!this.send({ type: 'ice-candidate', candidate, target: peerId })) {
        console.warn('Could not send an ICE candidate: signaling is disconnected.');
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.isCurrent(peerId, pc) && pc.connectionState === 'failed') {
        this.onFailure();
      }
    };
    return pc;
  }

  isCurrent(peerId, pc) {
    return this.connections.get(peerId) === pc;
  }

  async negotiate(peerId, operation, pc) {
    try {
      pc ??= this.create(peerId);
      await operation(pc);
    } catch (error) {
      if (pc && !this.isCurrent(peerId, pc)) return;
      console.warn('Screen share negotiation failed:', error?.name);
      this.remove(peerId);
      this.onFailure();
    }
  }

  async offer(peerId, stream) {
    await this.negotiate(peerId, async pc => {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await pc.setLocalDescription(await pc.createOffer());
      this.sendDescription(peerId, pc, 'offer');
    });
  }

  async answer(peerId, offer, onStream) {
    await this.negotiate(peerId, async pc => {
      pc.ontrack = ({ streams }) => {
        if (this.isCurrent(peerId, pc) && streams[0]) {
          onStream(streams[0], () => this.isCurrent(peerId, pc) && pc.connectionState !== 'failed');
        }
      };
      await this.setRemoteDescription(peerId, pc, offer);
      if (!this.isCurrent(peerId, pc)) return;
      await pc.setLocalDescription(await pc.createAnswer());
      this.sendDescription(peerId, pc, 'answer');
    });
  }

  async acceptAnswer(peerId, answer) {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    await this.negotiate(peerId, connection => this.setRemoteDescription(peerId, connection, answer), pc);
  }

  sendDescription(peerId, pc, type) {
    if (this.isCurrent(peerId, pc) && !this.send({ type, [type]: pc.localDescription, target: peerId })) {
      throw new Error('Signaling is disconnected.');
    }
  }

  async setRemoteDescription(peerId, pc, description) {
    await pc.setRemoteDescription(description);
    const queued = this.pendingIce.get(peerId);
    if (!queued || !this.isCurrent(peerId, pc)) return;
    for (const candidate of queued) {
      if (!this.isCurrent(peerId, pc)) return;
      await this.addIceCandidate(pc, candidate);
    }
    if (this.isCurrent(peerId, pc)) this.pendingIce.delete(peerId);
  }

  async receiveIce(peerId, candidate) {
    if (!peerId || !candidate) return;
    const pc = this.connections.get(peerId);
    if (pc?.remoteDescription && !this.pendingIce.has(peerId)) {
      await this.addIceCandidate(pc, candidate);
      return;
    }

    if (!this.pendingIce.has(peerId)) {
      if (this.pendingIce.size >= 256) return;
      this.pendingIce.set(peerId, []);
    }
    const queued = this.pendingIce.get(peerId);
    if (queued.length < 128) queued.push(candidate);
  }

  async addIceCandidate(pc, candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      if (pc.signalingState !== 'closed') console.warn('Could not add ICE candidate:', error?.name);
    }
  }

  closeConnection(peerId) {
    const pc = this.connections.get(peerId);
    this.connections.delete(peerId);
    pc?.close();
  }

  remove(peerId) {
    this.pendingIce.delete(peerId);
    this.closeConnection(peerId);
  }

  clear() {
    for (const peerId of this.connections.keys()) this.closeConnection(peerId);
    this.pendingIce.clear();
  }
}

async function playRemoteScreen(video, status, stream, isCurrent) {
  if (video.srcObject === stream) return;
  video.srcObject = stream;

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'btn primary';
  playButton.textContent = 'Play stream';
  const play = async () => {
    try {
      await video.play();
      if (!isCurrent()) return;
      status.replaceChildren();
      status.style.display = 'none';
    } catch (error) {
      if (!isCurrent()) return;
      if (error?.name === 'NotAllowedError') {
        status.replaceChildren(playButton);
      } else {
        console.warn('Could not play the screen share:', error?.name);
        status.textContent = 'The screen share could not play. Leave the room and rejoin to try again.';
      }
      status.style.display = 'grid';
    }
  };
  playButton.onclick = play;
  await play();
}
