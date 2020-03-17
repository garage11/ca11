#!/usr/bin/env node
import _ from 'lodash'
import {__dirname} from './lib/utils.js'
import chalk from 'chalk'
import chokidar from 'chokidar'
import CleanCSS from 'clean-css'
import connect from 'connect'
import fs from 'fs-extra'
import globby from 'globby'
import globImporter from 'node-sass-glob-importer'
import imagemin from 'imagemin'
import imageminJpegtran from 'imagemin-jpegtran'
import imageminPngquant from 'imagemin-pngquant'
import mount from 'connect-mount'
import path from 'path'
import rc from 'rc'
import rollup from 'rollup'
import rollupCommonjs from '@rollup/plugin-commonjs'
import rollupReplace from '@rollup/plugin-replace'
import rollupResolve from '@rollup/plugin-node-resolve'
import rollupTerser from 'rollup-plugin-terser'
import sass from 'node-sass'
import serveStatic from 'serve-static'
import Task from './lib/task.js'
import tinylr from 'tiny-lr'
import VuePack from '@garage11/vuepack'
import yargs from 'yargs'

import svgIcon from 'vue-svgicon/dist/lib/build.js'


let settings = rc('ca11', {host: '127.0.0.1', port: 35729})
import themeSettings from '@ca11/webphone-theme'
settings.theme = themeSettings

settings.baseDir = path.resolve(path.join(__dirname, '../'))
settings.buildDir = path.join(settings.baseDir, 'build')
settings.srcDir = path.resolve(path.join(settings.baseDir, 'packages', 'webphone'))
settings.themeDir = path.resolve(path.join(settings.baseDir, 'packages', 'webphone-theme'))
settings.nodeDir = path.resolve(path.join(settings.baseDir, 'node_modules'))
settings.tmpDir = path.join(settings.buildDir, '.tmp')

const tasks = {}

const cleanCSS = new CleanCSS({level: 2, returnPromise: true, sourceMap: true})
const vuePack = new VuePack({pathfilter: ['packages', 'webphone', 'src', 'components']})

// Maps tasks to entrypoints.
const entrypoint = {
    html: 'index.html',
    js: 'js/app.js',
    scss: 'scss/ca11/app.scss',
    vue: 'components/**/*.vue',
}

tasks.assets = new Task('assets', async function() {
    svgIcon.default({
        sourcePath: path.join(settings.themeDir, 'svg'),
        targetPath: path.join(settings.themeDir, 'icons'),
        ext: 'js',
        es6: true,
        tpl: '',
        idSP: '_',
    })

    const files = await imagemin([path.join(settings.themeDir, 'img', '*.{jpg,png}')], {
        destination: path.join(settings.buildDir, 'static', 'img'),
        plugins: [
            imageminJpegtran(),
            imageminPngquant({
                quality: [0.6, 0.8]
            })
        ]
    })

    await Promise.all([
        fs.copy(path.join(settings.themeDir, 'audio'), path.join(settings.buildDir, 'static', 'audio')),
        fs.copy(path.join(settings.themeDir, 'fonts'), path.join(settings.buildDir, 'static', 'fonts')),
    ])
})

tasks.build = new Task('build', async function() {
    await tasks.vue.start(entrypoint.vue)
    await Promise.all([
        tasks.scss.start(entrypoint.scss),
        tasks.js.start(entrypoint.js),
        tasks.html.start(entrypoint.html),
    ])
})

tasks.html = new Task('html', async function() {
    const indexFile = await fs.readFile(path.join(settings.srcDir, 'index.html'))
    const compiled = _.template(indexFile)
    const html = compiled({settings})

    await fs.writeFile(path.join(settings.buildDir, 'index.html'), html)
})

tasks.js = new Task('js', async function() {
    if (!settings.production) {
        // Snowpack only requires a light-weight copy action to the build dir.
        let targets = (await globby([path.join(settings.srcDir, '**', '*.js')]))
            .map((i) => fs.copy(i, path.join(settings.buildDir, 'static', i.replace(settings.srcDir, ''))))

        await Promise.all(targets)
    } else {
        // Use rollup to generate an optimized bundle.
        const bundle = await rollup.rollup({
            input: path.join(settings.srcDir, this.ep.raw),
            plugins: [
                rollupResolve(), rollupCommonjs(), rollupTerser.terser(),
                rollupReplace({
                    'process.env.NODE_ENV': '"production"', // Needed for Vue esm build
                })],
        })

        const target = path.join(settings.buildDir, 'static', `${this.ep.filename}.js`)

        await bundle.write({
            file: target,
            format: 'iife',
            name: 'app',
            sourcemap: true,
        })


        return ({size: (await fs.readFile(target)).length})
    }
})

tasks.scss = new Task('scss', async function() {
    let target = {
        css: path.join(settings.buildDir, 'static', `${this.ep.filename}.css`),
        map: path.join(settings.buildDir, 'static', `${this.ep.filename}.css.map`),
    }

    return new Promise((resolve, reject) => {
        sass.render({
            file: path.join(settings.srcDir, this.ep.dirname, `${this.ep.filename}.scss`),
            importer: globImporter(),
            includePaths: [
                'node_modules',
                path.join(settings.srcDir, 'scss'),
                path.join(settings.srcDir, 'scss', 'ca11'),
            ],
            outFile: target.css,
            sourceMap: !settings.production,
            sourceMapContents: true,
            sourceMapEmbed: false,
        }, async function(err, sassObj) {
            if (err) reject(err.formatted)

            let cssRules
            const promises = []

            if (settings.production) {
                cssRules = (await cleanCSS.minify(sassObj.css)).styles
            } else {
                cssRules = sassObj.css
                promises.push(fs.writeFile(target.map, sassObj.map))
            }

            promises.push(fs.writeFile(target.css, cssRules))
            await Promise.all(promises)

            resolve({size: cssRules.length})
        })
    })
})

tasks.vue = new Task('vue', async function() {
    const targets = await globby([path.join('packages', 'webphone', this.ep.raw)])
    const templates = await vuePack.compile(targets)
    // This is an exceptional build target, because it is not
    // a module that is available from Node otherwise.
    await Promise.all([
        fs.writeFile(path.join(settings.srcDir, 'templates.js'), templates),
        fs.writeFile(path.join(settings.buildDir, 'static', 'templates.js'), templates),
    ])
})

tasks.watch = new Task('watch', async function() {
    await tasks.build.start()
    return new Promise((resolve, reject) => {
        var app = connect()
        app.use(mount('/static', serveStatic(path.join(settings.buildDir, 'static'))))
            .use(async(req, res, next) => {
                if (req.url.includes('livereload.js')) {
                    next()
                } else {
                    const html = await fs.readFile(path.join(settings.buildDir, 'index.html'))
                    res.setHeader('Content-Type', 'text/html; charset=UTF-8')
                    res.end(html)
                }

            })
            .use(tinylr.middleware({app}))

            .listen({host: settings.host, port: settings.port}, () => {
                this.log(`development server listening: ${chalk.grey(`${settings.host}:${settings.port}`)}`)
                resolve()
            })

        chokidar.watch([
            path.join('!', settings.srcDir, 'js', 'templates.js'), // Templates are handled by the Vue task
            path.join(settings.srcDir, '**', '*.js'),
        ]).on('change', async() => {
            await tasks.js.start(entrypoint.js)
            tinylr.changed('app.js')
        })

        chokidar.watch(path.join(settings.srcDir, '**', '*.vue')).on('change', async() => {
            await tasks.vue.start(entrypoint.vue)
            tinylr.changed('templates.js')
        })

        chokidar.watch(path.join(settings.srcDir, '**', '*.scss')).on('change', async() => {
            await tasks.scss.start(entrypoint.scss)
            tinylr.changed('app.css')
        })

        chokidar.watch(path.join(settings.srcDir, 'index.html')).on('change', async() => {
            await tasks.html.start(entrypoint.html)
            tinylr.changed('index.html')
        })
    })
})

// eslint-disable-next-line no-unused-vars
const args = yargs
    .usage('Usage: $0 [task]')
    .detectLocale(false)
    .showHelpOnFail(true)
    .help('help')
    .option('production', {alias: 'p', default: false, description: 'Production mode', type: 'boolean'})
    .middleware(async(argv) => {
        // Make sure the required build directories exist.
        await fs.mkdirp(path.join(settings.buildDir, 'static', 'js'))
        settings.production = argv.production
        if (settings.production) {
            tasks.watch.log(`build optimization: ${chalk.green('enabled')}`)
        } else {
            tasks.watch.log(`build optimization: ${chalk.red('disabled')}`)
        }
    })
    .command('assets', 'prepare theme files', () => {}, (argv) => {
        tasks.assets.start()
    })
    .command('build', 'generate project files', () => {}, (argv) => {
        tasks.build.start()
    })
    .command('html', 'generate index.html', () => {}, (argv) => {
        tasks.html.start(entrypoint.html)
    })
    .command('js', 'prepare JavaScript for the browser', () => {}, (argv) => {
        tasks.js.start(entrypoint.js)
    })
    .command('scss', 'compile SCSS styles to CSS', () => {}, (argv) => {
        tasks.scss.start(entrypoint.scss)
    })
    .command('vue', 'compile Vue templates to ESM', () => {}, (argv) => {
        tasks.vue.start(entrypoint.vue)
    })
    .command('watch', 'start development server', () => {}, (argv) => {
        tasks.watch.start()
    })
    .demandCommand()
    .argv