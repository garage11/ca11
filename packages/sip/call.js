import EventEmitter from 'eventemitter3'
import { SipRequest, SipResponse, utils } from './message.js'

class CallSip extends EventEmitter {

    constructor(client, {description, id}) {
        super()
        this.client = client
        this.tracks = {}
        // TODO: Refactor description.endpoint to description.extension
        this.dialog = {
            branch: null,
            fromTag: null,
            toTag: utils.token(12),
        }

        this.id = id
        console.log("NEW CALL", id)
        this.on('message', this.onMessage.bind(this))
        this.description = description
    }


    async acceptInvite(localStream) {
        this.pc = new RTCPeerConnection({
            iceServers: this.client.stun.map((i) => ({urls: i})),
            sdpSemantics:'unified-plan',
        })

        this.pc.onnegotiationneeded = async() => {
            console.log("NEGOTIATE")
        }
        this.pc.ontrack = this.onTrack.bind(this)

        await this.pc.setRemoteDescription({sdp: this.inviteContext.context.content, type: 'offer'})

        for (const track of localStream.getTracks()) {
            this.pc.addTrack(track, localStream)
        }


        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        console.log("BRANCH 1", this.dialog.branch)

        this.inviteOkMessage = new SipResponse(this.client, {
            branch: this.dialog.branch,
            callId: this.id,
            code: 200,
            content: answer.sdp,
            cseq: this.inviteContext.context.cseq,
            extension: this.description.endpoint,
            fromTag: this.dialog.fromTag,
            method: 'INVITE',
            toTag: this.dialog.toTag,
        })

        this.client.socket.send(this.inviteOkMessage)
        this.emit('invite-accepted')
    }


    hold() {
        console.log("HOLD CALL")
    }


    async initIncoming({context, localStream}) {
        const message = context

        this.inviteContext = message
        // Set remote description as part of an incoming call.
        this.dialog.fromTag = message.context.header.From.tag
        if (!this.dialog.branch) {
            this.dialog.branch = message.context.header.Via.branch
            console.log("BRANCH 2(SET)", this.dialog.branch)
        }

        this.inviteCseq = message.context.cseq

        const tryingMessage = new SipResponse(this.client, {
            branch: message.context.header.Via.branch,
            callId: this.id,
            code: 100,
            cseq: message.context.cseq,
            extension: this.description.endpoint,
            fromTag:  message.context.header.From.tag,
            method: 'INVITE',
        })

        const ringingMessage = new SipResponse(this.client, {
            branch: message.context.header.Via.branch,
            callId: this.id,
            code: 180,
            cseq: message.context.cseq,
            extension: this.description.endpoint,
            fromTag:  this.dialog.fromTag,
            method: 'INVITE',
            toTag: this.dialog.toTag,
        })

        this.client.socket.send(tryingMessage)
        this.client.socket.send(ringingMessage)
    }


    async initOutgoing(localStream) {
        this.pc = new RTCPeerConnection({
            iceServers: this.client.stun.map((i) => ({urls: i})),
            sdpSemantics:'unified-plan',
        })

        this.pc.ontrack = this.onTrack.bind(this)
        this.pc.onicegatheringstatechange = () => {
            // Send the invite once the candidates are part of the sdp.
            if (this.pc.iceGatheringState === 'complete') {
                this.client.invite(this)
            }
        }

        for (const track of localStream.getTracks()) {
            this.pc.addTrack(track, localStream)
        }

        const offer = await this.pc.createOffer()
        this.pc.setLocalDescription(offer)
    }


    async onMessage(message) {
        console.log("ON MESSAge", this.dialog.branch)
        if (message.context.header.Via.branch && !this.dialog.branch) {
            this.dialog.branch = message.context.header.Via.branch
        }

        if (message.context.method === 'INVITE') {
            if (message.context.status === 'Unauthorized') {
                if (message.context.digest) {
                    const inviteMessage = new SipRequest(this.client, {
                        callId: this.id,
                        content: this.pc.localDescription.sdp,
                        cseq: message.context.cseq,
                        digest: message.context.digest,
                        extension: this.description.endpoint,
                        method: 'INVITE',
                    })

                    this.client.socket.send(inviteMessage)

                    const ackMessage = new SipRequest(this.client, {
                        callId: this.id,
                        cseq: message.context.cseq,
                        extension: this.description.endpoint,
                        method: 'ACK',
                    })

                    this.client.socket.send(ackMessage)
                }
            } else if (message.context.status === 'OK') {
                this.dialog.toTag = message.context.header.To.tag
                this.dialog.fromTag = message.context.header.From.tag
                // Set remote description as part of an outgoing call.
                await this.pc.setRemoteDescription({sdp: message.context.content, type: 'answer'})

                const ackMessage = new SipRequest(this.client, {
                    callId: this.id,
                    cseq: message.context.cseq,
                    extension: this.description.endpoint,
                    method: 'ACK',
                    transport: 'ws',
                })

                // Outgoing call accepted;
                this.emit('outgoing-accepted')

                this.client.socket.send(ackMessage)
            }
        } else if (message.context.method === 'BYE') {
            this.emit('terminate', {callID: this.id})
        } else if (message.context.method === 'MESSAGE') {
            this.emit('context', JSON.parse(message.context.content))
        } else if (message.context.method === 'ACK') {
            console.log("SET REMOTE DESCRIPTION")
        }
    }


    onTrack(track) {
        const receivers = this.pc.getReceivers()
        if (!receivers.length) return

        const newTracks = []
        for (const receiver of receivers) {
            if (!this.tracks[receiver.track.id]) {
                this.tracks[receiver.track.id] = receiver.track
                newTracks.push(receiver.track)
            }
        }
        if (!newTracks.length) return

        for (const track of newTracks) {
            const newStream = new MediaStream()
            newStream.addTrack(track)
            this.emit('track', newStream, track)
        }
    }


    terminate() {
        this.client.cseq += 1
        const byeMessage = new SipRequest(this.client, {
            branch: this.dialog.branch,
            callId: this.id,
            cseq: this.client.cseq,
            extension: this.description.endpoint,
            fromTag: this.dialog.fromTag,
            method: 'BYE',
            toTag: this.dialog.toTag,
            transport: 'ws',
        })

        console.log("BRANCH 3", this.dialog.branch)

        console.log("SEND BYE", byeMessage)

        this.client.socket.send(byeMessage)
    }


    transfer(targetCall) {
        if (typeof targetCall === 'string') {
            this.session.refer(`sip:${targetCall}@ca11.app`)
        } else {
            this.session.refer(targetCall.session)
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

export default CallSip
