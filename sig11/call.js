import { mergeDeep } from '../webphone/lib/utils.js'

class Sig11Call {

    constructor(app, description) {

        this.candidates = []
        this.node = description.node
        this.state.protocol = 'sig11'

        const state = {
            name: this.node.name,
            number: this.node.number,
        }

        state.direction = description.direction

        if (state.direction === 'outgoing') {
            state.status = 'new'
        } else {
            // An incoming call starts with the sdp offer.
            this.offer = description.offer
            state.status = 'invite'
        }

        mergeDeep(this.state, state)
    }


    /**
    * An incoming call is accepted by the user. Let's
    * start with establishing a WebRTC session. ICE
    * candidates can be already available from
    * `sig11:call-candidate`, because ICE gathering
    * is an async process that starts when `setLocalDescription`
    * is executed on the initiating side.
    */
    async accept() {
        this.pc = new RTCPeerConnection({
            iceServers: this.app.state.settings.webrtc.stun.map((i) => ({urls: i})),
        })

        this.rtcEvents()

        const stream = this.app.state.settings.webrtc.media.stream
        const localStream = this.app.media.streams[stream[stream.type].id]

        for (const track of localStream.getTracks()) {
            this.pc.addTrack(track, localStream)
        }

        await this.pc.setRemoteDescription({sdp: this.offer, type: 'offer'})
        const answer = await this.pc.createAnswer()

        this.candidates.forEach((c) => {
            if (c) this.pc.addIceCandidate(new RTCIceCandidate(c))
        })

        delete this.candidates
        // Triggers ICE negotiation.
        await this.pc.setLocalDescription(answer)
        // Ask the endpoint about the number.
        await this.app.sig11.emit(this.node.id, 'call-answer', {
            answer: answer.sdp,
            callId: this.id,
        })

        this.startCall({message: this.translations.accepted})
    }


    hold() {
        this.setState({hold: {active: !this.state.hold.active}})
    }


    incoming() {
        // super.incoming()
    }


    onTrack(e) {
        const stream = e.streams[0]
        if (!this.app.media.streams[stream.id]) this.addStream(stream, 'video')

        const path = `caller.calls.${this.id}.streams.${stream.id}`
        e.track.onunmute = () => {this.app.setState({muted: false}, {path})}
        e.track.onmute = () => {this.app.setState({muted: true}, {path})}
        e.track.onended = () => {this.removeStream(stream.id)}
    }

    async outgoing() {
        // super.outgoing()

        this.pc = new RTCPeerConnection({
            iceServers: this.app.state.settings.webrtc.stun.map((i) => ({urls: i})),
        })

        this.rtcEvents()

        const stream = this.app.state.settings.webrtc.media.stream
        const localStream = this.app.media.streams[stream[stream.type].id]

        for (const track of localStream.getTracks()) {
            this.pc.addTrack(track, localStream)
        }

        const offer = await this.pc.createOffer()
        // Triggers ICE negotiation.
        this.pc.setLocalDescription(offer)

        // Send the offer to the target node Id.
        await this.app.sig11.emit(this.node.id, 'call-offer', {
            callId: this.id,
            offer: this.pc.localDescription.sdp,
        })
    }


    rtcEvents() {
        // send any ice candidates to the other peer
        this.pc.onicecandidate = ({candidate}) => {
            // Send candidates as soon the outgoing call is confirmed
            // with the remote node sending a `c ll-answer`.
            this.app.sig11.emit(this.node.id, 'call-candidate', {
                callId: this.id,
                candidate,
            })
        }

        // once remote track media arrives, show it in remote video element
        this.pc.ontrack = this.onTrack.bind(this)
    }


    /**
    * Other side accepted the call. Process sdp with the
    * RTCPeerConnection that was made in `outgoing`.
    * @param {String} answer - The raw SDP message.
    */
    async setupAnswer(answer) {
        await this.pc.setRemoteDescription({sdp: answer, type: 'answer'})
        this.startCall()
    }


    async terminate(status, {remote = true} = {}) {
        // Close connected streams when the call is already
        // flowing. Skip when the call is terminated before
        // the peer is connected.
        if (this.pc) {
            this.pc.close()
        }

        if (remote) {
            await this.app.sig11.emit(this.node.id, 'call-terminate', {
                callId: this.id,
                status,
            })
        }
    }

    unhold() {
        if (this.session) {
            this.session.unhold({
                sessionDescriptionHandlerOptions: {
                    constraints: this.app.media._getUserMediaFlags(),
                },
            })
            this.setState({hold: {active: false}})
        }
    }
}

export default Sig11Call
