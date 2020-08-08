export default (app) => {

    return {
        computed: {
            protocols: function() {
                let protocols = [
                    {disabled: !this.sip.enabled, name: 'SIP', value: 'sip'},
                    {disabled: !this.sig11.enabled, name: 'SIG11', value: 'sig11'},
                ]
                return protocols
            },
        },
        data: function() {
            return {
                tooltip: 'SIG11: enabled\nSIP:Disabled',
            }
        },
        store: {
            dnd: 'app.dnd',
        },
        watch: {
            dnd: function(dnd) {
                app.setState({app: {dnd}}, {persist: true})
            },
        },
    }
}
