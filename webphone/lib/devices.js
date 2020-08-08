class Devices {

    constructor(app) {
        this.app = app

        // Detect changes in connected devices while running.
        if (this.app.env.isBrowser) {
            navigator.mediaDevices.ondevicechange = async() => {
                // While the event handler is only registered once; it is triggered
                // twice in a row nevertheless. Skip the second call.
                const vaultUnlocked = this.app.state.app.vault.unlocked
                const mediaPermission = this.app.state.settings.webrtc.media.permission
                const isAuthenticated = this.app.state.session.authenticated

                if (!this._throttle && vaultUnlocked && mediaPermission && isAuthenticated) {
                    this._throttle = true
                    await this.verifySinks()
                    this._throttle = false
                }
            }
        }
    }


    /**
    * Compare stored sinks with sinks from the browser device list.
    * Indicates whether a device sink was added or removed, compared
    * to the stored device sinks.
    * @returns {Array} - Difference between browser and stored sink list.
    */
    compareSinks({input, output}) {
        // Find devices that are in the browser list, but not in store.
        let addedInputDevices = input.filter((i) => !this.cached.input.find((j) => i.id === j.id))
        let removedInputDevices = this.cached.input.filter((i) => !input.find((j) => i.id === j.id))

        let addedOutputDevices = output.filter((i) => !this.cached.output.find((j) => i.id === j.id))
        let removedOutputDevices = this.cached.output.filter((i) => !output.find((j) => i.id === j.id))

        return {
            added: addedInputDevices.concat(addedOutputDevices),
            removed: removedInputDevices.concat(removedOutputDevices),
        }
    }


    async query() {
        let devices
        let input = []
        let output = []
        try {
            devices = await navigator.mediaDevices.enumerateDevices()
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err)
        }

        for (const device of devices) {
            if (device.label) {
                if (device.id === 'default') device.label = this.app.$t('default').ca()
                if (device.kind === 'audioinput') {
                    input.push({id: device.deviceId, name: device.label, valid: true})
                } else if (device.kind === 'audiooutput') {
                    output.push({id: device.deviceId, name: device.label, valid: true})
                }
            }

        }

        return {input, output}
    }


    toString() {
        return `${this.app}[devices] `
    }


    validateSinks({input, output}) {
        const browserSinks = {input, output}
        let storedDevices = this.app.utils.copyObject({input: this.cached.input, output: this.cached.output})

        this.sinks = this.app.state.settings.webrtc.devices.sinks
        let valid = true

        for (const sinkCategory of Object.keys(this.sinks)) {
            const sink = this.sinks[sinkCategory]

            const sinkType = sinkCategory.endsWith('Input') ? 'input' : 'output'
            if (sink.id === 'default') continue

            let storedDevice = storedDevices[sinkType].find((i) => i.id === sink.id)
            if (!storedDevice) {
                // The stored sink is not in the stored input/output device options
                // anymore. Add the missing option to the stored device list.
                this.app.logger.debug(`${this}restoring sink '${sink.name}'`)
                storedDevice = sink
                storedDevice.valid = true
                storedDevices[sinkType].push(storedDevice)
            }
            // Selected input sink is not in the browser device list.
            // Mark the device invalid and mark whole validation as
            // invalid.
            if (!browserSinks.input.find((i) => i.id === sink.id) && !browserSinks.output.find((i) => i.id === sink.id)) {
                storedDevice.valid = false
                valid = false
            }
        }

        storedDevices.ready = valid
        this.app.setState(storedDevices, {path: 'settings.webrtc.devices'})
        this.app.logger.debug(`${this}audio sink list is ${valid ? 'valid' : 'invalid'}`)
        return valid
    }


    async verifySinks() {
        // Cached query; what currently is in store.
        this.cached = this.app.utils.copyObject({
            input: this.app.state.settings.webrtc.devices.input,
            output: this.app.state.settings.webrtc.devices.output,
        })
        // Fresh query.
        const {input, output} = await this.query()

        if (!this.cached.input.length || !this.cached.output.length) {
            this.app.logger.debug(`${this}no sinks stored yet; store query list`)
            // No sinks stored before; fill the output and input device options.
            this.app.setState({settings: {webrtc: {devices: {input, output}}}}, {persist: true})
        } else {
            const sinkDiff = this.compareSinks({input, output})

            // Notify about newly connected devices.
            for (const device of sinkDiff.added) {
                const message = this.app.$t('added: "{name}"', {name: device.name})
                this.app.logger.info(`${this}${message}`)
                this.app.notify({icon: 'microphone', message, type: 'info'})
            }

            // There are options available; verify if the selected sinks are valid.
            if (this.validateSinks({input, output})) {
                // Notify about devices that are *safely* removed from the devices list.
                for (const device of sinkDiff.removed) {
                    const message = this.app.$t('removed: "{name}"', {name: device.name})
                    this.app.logger.info(`${this}${message}`)
                    this.app.notify({icon: 'microphone', message, type: 'info'})
                }
                // Only overwrite the device list when the current device
                // is in the actual device list; so we can add a validation
                // error on the non-existing device.
                this.app.setState({settings: {webrtc: {devices: {input, output}}}}, {persist: true})
            } else {
                const invalidInput = this.app.state.settings.webrtc.devices.input.filter((i) => !i.valid)
                const invalidOutput = this.app.state.settings.webrtc.devices.output.filter((i) => !i.valid)

                for (const device of invalidInput.concat(invalidOutput)) {
                    const message = this.app.$t('unavailable: "{name}"', {name: device.name})
                    this.app.notify({icon: 'microphone', message, type: 'warning'})
                }
            }
        }
    }
}

export default Devices
