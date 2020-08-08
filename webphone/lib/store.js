class MemoryStore {
    constructor() {
        this.data = {}
    }

    getItem(key) {
        return this.data[key]
    }

    removeItem(key) {
        delete this.data[key]
    }

    setItem(key, value) {
        this.data[key] = value
    }
}


class StateStore {

    constructor(app) {
        this.app = app
        this.schema = 1

        this.cache = {
            encrypted: {},
            unencrypted: {},
        }

        if (this.app.env.isBrowser) {
            this.store = localStorage
        } else {
            this.store = new MemoryStore()
        }
    }


    clear() {
        let keys
        if (this.app.env.isNode) keys = Object.keys(this.store.data)
        else keys = this.store
        for (const key in keys) {
            if (this.store.getItem(key) && key !== 'schema') this.remove(key)
        }
    }


    get(key) {
        if (this.app.verbose) this.app.logger.debug(`${this}get value for key '${key}'`)
        var value = this.store.getItem(key)
        if (value) {
            return JSON.parse(value)
        }
        return null
    }


    remove(key) {
        if (this.get(key)) this.store.removeItem(key)
    }


    reset() {
        this.store.clear()
    }


    set(key, value) {
        this.store.setItem(key, JSON.stringify(value))
    }


    toString() {
        return `${this.app}[store] `
    }


    valid() {
        let schema = this.get('schema')
        if (schema === null || schema !== this.schema) {
            this.set('schema', this.schema)
            this.app.logger.warn(`${this}store schema changed! db: ${schema} state: ${this.schema}`)
            if (schema === null) return null
            else return false
        }

        return true
    }
}

export default StateStore
