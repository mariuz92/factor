const { ensureDirSync, emptyDirSync, copy, copySync, writeFileSync } = require("fs-extra")

const glob = require("glob").sync
const consola = require("consola")
const { resolve, basename, dirname } = require("path")
const execa = require("execa")
export default Factor => {
  return new class {
    constructor() {
      this.folderName = "serverless"

      this.buildDirectory = resolve(Factor.$paths.get("app"), this.folderName)

      this.relativeDir = `${this.folderName}`

      this.serverlessPackages = require(Factor.$paths.get("plugins-loader-serverless"))

      this.watchPaths = []
      this.dependencies = {}
      this.localDependencies = {}

      this.builder()
    }

    builder() {
      this.addConfig()
      this.buildServerlessFolder()

      Factor.$filters.add("build-watchers", _ => {
        _.push({
          name: "Functions Rebuild",
          files: this.watchPaths.map(_ => `${_}/**`),
          callback: ({ event, path }) => {
            this.makePackages()
          }
        })
        return _
      })
    }

    addConfig() {
      Factor.$filters.add("firebase-config", _ => {
        _.hosting = _.hosting || {}

        _.hosting.rewrites = [
          {
            source: "**",
            function: "server"
          }
        ]

        _.functions = {
          source: this.relativeDir
        }

        return _
      })
    }

    buildServerlessFolder() {
      this.clearBuildDirectory()
      this.copyAppDirectories()
      this.makePackages()
      this.copyFunctionsFiles()
      this.runtimeFile()
    }

    clearBuildDirectory() {
      ensureDirSync(this.buildDirectory)
      emptyDirSync(this.buildDirectory)
    }

    copyAppDirectories() {
      const files = glob(resolve(Factor.$paths.get("app"), "*"), {
        ignore: ["**/node_modules", "**/package.json", "**/start.js", `**/${this.folderName}`]
      })

      files.forEach(f => {
        copySync(f, resolve(this.buildDirectory, basename(f)))
      })
    }

    getDependencies() {
      let baseDependencies = {}

      Object.values(this.serverlessPackages).forEach(pkg => {
        baseDependencies[pkg.module] = `>${pkg.version}`
      })

      this._recursiveDeps(baseDependencies)
    }

    _recursiveDeps(packages = {}) {
      Object.keys(packages).forEach(packageName => {
        if (packageName.includes("@factor")) {
          if (!this.localDependencies[packageName]) {
            this.localDependencies[packageName] = this._localModule(
              packageName,
              "./factor_modules/"
            )

            const packagePath = `${packageName}/package.json`
            const deps = require(packagePath).dependencies
            if (deps) {
              this._recursiveDeps(deps)
            }
          }
        } else {
          this.dependencies[packageName] = packages[packageName]
        }
      })
    }

    _copyLocalDeps(localDependencies) {
      Object.keys(localDependencies).forEach(packageName => {
        const packagePath = `${packageName}/package.json`

        const modPath = dirname(require.resolve(packagePath))
        const modDest = resolve(this.buildDirectory, "factor_modules", packageName)

        this.watchPaths.push(modPath)

        ensureDirSync(modDest)
        emptyDirSync(modDest)
        copySync(modPath, modDest, { dereference: true })

        // Yarn/NPM just copy the locals to node_modules
        // Need to update that as well for local dev
        const modDestNode = resolve(this.buildDirectory, "node_modules", packageName)

        ensureDirSync(modDestNode)
        emptyDirSync(modDestNode)
        copySync(modPath, modDestNode, { dereference: true })

        const destPackage = `${modDest}/package.json`
        let newPackage = require(destPackage)

        if (newPackage.dependencies) {
          Object.keys(newPackage.dependencies).forEach(packageName => {
            if (packageName.includes("@factor")) {
              newPackage.dependencies[packageName] = this._localModule(packageName, "../../")
            }
          })
        }

        writeFileSync(destPackage, JSON.stringify(newPackage, null, 4))
      })
    }

    _localModule(packageName, relation) {
      return `file:${relation}${packageName}`
    }

    async makePackages() {
      this.getDependencies()

      const { pkg } = Factor.$config

      const lines = {
        name: "@factor/serverless-directory",
        description: "** GENERATED FILE - DONT EDIT DIRECTLY **",
        version: pkg.version,
        license: "GPL3.0",
        scripts: {
          deps: "yarn install --ignore-engines"
        },
        engines: { node: "8" },
        dependencies: this.localDependencies,
        devDependencies: {},
        timestamp: +new Date()
      }

      writeFileSync(`${this.buildDirectory}/package.json`, JSON.stringify(lines, null, 4))

      this._copyLocalDeps(this.localDependencies)
    }

    copyFunctionsFiles() {
      copySync(resolve(__dirname, "files"), this.buildDirectory)
    }

    showOutput(name, runner) {
      let messages = []
      let logType = "success"
      return new Promise((resolve, reject) => {
        runner.stdout.on("data", function(data) {
          messages.push(data.toString())
        })
        runner.stderr.on("data", function(data) {
          messages.push(data.toString())
        })
        runner.on("close", code => {
          messages.unshift(`${name} >>>`)
          consola[logType](`${name} [Finished - ${code}]`)
          resolve()
        })
      })
    }

    runtimeFile() {
      // Package.json is still getting generated (apparently)
      // Yarn/NPM will use parent package.json if the CWD one is missing
      setTimeout(async () => {
        const { spawn } = require("child_process")

        const runFolder = `${process.cwd()}/${this.relativeDir}`

        const runner = spawn("yarn", ["deps"], {
          cwd: runFolder
        })

        await this.showOutput("Serverless Packages Install", runner)
      }, 500)
    }
  }()
}
