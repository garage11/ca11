import Call from './call.js'
import EventEmitter from 'eventemitter3'
import md5 from 'blueimp-md5'

import { SipRequest, SipResponse, utils } from './message.js'


class ClientSip extends EventEmitter {

    constructor(options) {
        super()

        this.nc = 0
        this.ncHex = '00000000'
        this.cseq = 1

        this.calls = {}
        this.state = 'unregistered'
        Object.assign(this, options)

        this.uri = `sip:${this.endpoint}`
        this.contactName = utils.token(8)
    }


    authorizeMessage(message) {
        this.nc += 1
        const hex = this.nc.toString(16)
        this.ncHex = '00000000'.substr(0, 8 - hex.length) + hex

        this.cnonce = utils.token(12)
        const hash1 = md5(`${this.user}:${message.context.digest['Digest realm']}:${this.password}`)
        const hash2 = md5(`${message.context.method}:${this.uri}`)
        const response = md5(`${hash1}:${message.context.digest.nonce}:${this.ncHex}:${this.cnonce}:auth:${hash2}`)
        return [
            'Authorization: Digest algorithm=MD5',
            `username="${this.user}"`,
            `realm="${message.context.digest['Digest realm']}"`,
            `nonce="${message.context.digest.nonce}"`,
            `uri="${this.uri}"`,
            `response="${response}"`,
            `opaque="${message.context.digest.opaque}"`,
            'qop=auth',
            `cnonce="${this.cnonce}"`,
            `nc=${this.ncHex}`,
        ].join(', ')
    }


    connect() {
        this.socket = new WebSocket(`wss://${this.endpoint}`, 'sip')
        this.socket.onopen = () => {
            // Triggers a 401 to retrieve a 401 with digest.
            this.register()
        }

        this.socket.onmessage = (e) => {
            let call = null
            const message = this.parseMessage(e.data)

            if (message.context.code === 'PING') return

            if (message.context.method === 'OPTIONS') {
                this.options(message)
            }

            if (this.calls[message.context.header['Call-ID']]) {
                call = this.calls[message.context.header['Call-ID']]
                call.emit('message', message)
            } else {
                if(message.context.method === 'REGISTER') {
                    if (message.context.status === 'OK') {
                        this.emit('registered')
                    } else if (message.context.status === 'Unauthorized') {
                        this.register(message)
                    }
                } else if (message.context.method === 'INVITE') {
                    // An incoming call response.
                    if (message instanceof SipRequest) {
                        console.log("EXTENSION?", message.context)
                        const call = new Call(this, {
                            description: {
                                direction: 'incoming',
                                endpoint: 1000, // message.context.header.From.extension,
                                protocol: 'sip',
                            },
                            id: message.context.callId,
                        })
                        this.calls[call.id] = call
                        // Emit invite up to the SIP module that handles
                        // application state.
                        this.emit('invite', {context: message, handler: call})
                    }
                }
            }
        }

        this.socket.onclose = () => {
            console.log("CLOSED")
        }
    }


    invite(call) {
        // Associate call object using the Call-ID header line.
        this.calls[call.id] = call

        const message = new SipRequest(this, {
            callId: call.id,
            content: call.pc.localDescription.sdp,
            cseq: this.cseq,
            extension: call.description.endpoint,
            method: 'INVITE',
        })

        this.socket.send(message)
    }


    options(request) {
        const context = Object.assign(JSON.parse(JSON.stringify(request.context)), {
            method: 'OPTIONS',
        })

        context.branch = context.header.Via.branch
        const message = new SipResponse(this, context)
        this.socket.send(message)
    }


    parseMessage(rawSipMessage) {
        let type
        const context = {
            content: '',
        }

        let data = rawSipMessage.trim()
        if (data === '') {
            context.code = 'PING'
            return new SipRequest(this, context)
        }
        data = data.split('\r\n')
        const requestLine = data[0].split(' ')

        if (requestLine[0] === 'SIP/2.0') {
            type = 'response'
            context.code = requestLine[1]
            context.status = requestLine[2]
        } else {
            type = 'request'
            context.status = requestLine[0]
        }
        // Remove the header request/response line.
        data.shift()

        context.header = {}
        let isHeaderLine = true

        for (const line of data) {
            if (isHeaderLine) {
                const key = line.split(':')[0]
                const value = line.replace(`${key}:`, '').trim()
                context.header[key] = value

                if (key === 'Content-Length') {
                    isHeaderLine = false
                }
            } else {
                if (!line) continue
                // TODO: Add sdp parser.
                context.content += `${line}\r\n`
            }
        }

        const to = context.header.To.split(';')
        context.header.To = {}
        context.header.To.address = to[0]
        // Tag from To/From and Call-ID define a Dialog.
        if (to[1]) context.header.To.tag = to[1].split('=')[1]

        const from = context.header.From.split(';')
        context.header.From = {}
        context.header.From.address = from[0]
        if (from[1]) context.header.From.tag = from[1].split('=')[1]

        // SIP/2.0/WS 127.0.0.1:8088;rport;branch=z9hG4bKPj1b871699-11cc-4ae1-b4f0-08a4d29a81fa;alias
        const via = context.header.Via.split(';')
        context.header.Via = {}

        const branch = via.find((i) => i.includes('branch'))
        if (branch) {
            context.header.Via.branch = branch.split('=')[1]
        }

        if (context.header['WWW-Authenticate']) {
            context.digest = utils.commaSepToObject(context.header['WWW-Authenticate'])
        }

        if (context.header['Call-ID']) {
            context.callId = context.header['Call-ID']
        }

        const cseqHeader = context.header['CSeq'].split(' ')
        context.cseq = Number(cseqHeader[0])
        context.method = cseqHeader[1]

        if (type === 'request') return new SipRequest(this, context)
        else return new SipResponse(this, context)
    }


    register(message) {
        if (!this.callId) this.callId = utils.token(12)
        const context = {
            cseq: this.cseq,
            method: 'REGISTER',
        }

        if (message) {
            context.digest = message.context.digest
        }

        const request = new SipRequest(this, context)
        this.socket.send(request)
    }

}

export default ClientSip