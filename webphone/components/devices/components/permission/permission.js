export default (app) => {

    return {
        beforeDestroy: function() {
            clearInterval(this.intervalId)
        },
        computed: app.helpers.sharedComputed(),
        methods: Object.assign({}, app.helpers.sharedMethods()),
        props: {
            soundmeter: {default: true},
        },
        store: {
            app: 'app',
            devices: 'settings.webrtc.devices',
            env: 'env',
            media: 'settings.webrtc.media',
            settings: 'settings',
        },
    }
}
