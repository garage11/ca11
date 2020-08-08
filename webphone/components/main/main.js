export default (app) => {

    let splashInterval

    return {
        computed: app.helpers.sharedComputed(),
        data: function() {
            return {
                currentSplash: 0,
            }
        },
        destroyed: function() {
            clearInterval(splashInterval)
        },

        methods: Object.assign({
            classes: function(block) {
                let classes = {}

                if (block === 'component') {
                    classes[`theme-${this.ui.theme}`] = true
                } else if (block === 'panel') {
                    if (this.session.authenticated) classes.sidebar = true
                    if (this.overlay) classes['no-scroll'] = true
                }

                classes[`splash-${this.currentSplash}`] = true

                return classes
            },
            logout: function() {
                app.session.close()
            },
        }, {}),
        mounted: function() {
            splashInterval = setInterval(() => {
                this.currentSplash = (this.currentSplash + 1) % 7
            }, 60000)
        },
        store: {
            calls: 'caller.calls',
            description: 'caller.description',
            layer: 'ui.layer',
            overlay: 'ui.overlay',
            session: 'session',
            telemetry: 'settings.telemetry',
            ui: 'ui',
        },
    }
}
