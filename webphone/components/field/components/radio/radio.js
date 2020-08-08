export default (app, base) => {
    /**
    * @memberof fg.components
    */
    const FieldRadio = {
        data: function() {
            return {
                // Postfix in case of multiple instances.
                postfix: shortid(),
            }
        },
        extends: base,
        props: ['options'],
    }

    return FieldRadio
}
