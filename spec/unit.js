var File = require('vinyl')
  , fs = require('fs-extra')
  , slash = require('slash')
  , exec = require('child_process').exec

// var gulp = require("gulp")
var vashStatic = require('../index')

var MAIN_DIR = slash(__dirname).split("spec")[0]
  , TEST_RES = MAIN_DIR + "test-resources/"
  , TEMP_DIR = MAIN_DIR + "dist/tmp/"
  , SAMPLE_CACHE = TEST_RES + "sample-template-cache.json"

vashStatic.suppressWarnings(true)

// The default is "pg" anyway, but this is just to show you that you can change it to another directory name if you wish
vashStatic.setPageDirType("pg");

// vashStatic module types
var dirTypes = ["pg", "wg", "glb"]
  , aboutTmpl = TEST_RES + "pg/about/Index.vash"
  , homeTmpl = TEST_RES + "pg/home/tmpl/Index.vash" // contains subdirectory

function getTemplateFile(filePath) {
    return new File({
        contents: fs.readFileSync(filePath)
        , path: filePath
    });
}

describe("regSlash", function() {
	var fun = vashStatic.testable.regSlash

	it("should escape common regular expression characters", function() {
		expect(fun("?")).toBe("\\?")
		expect(fun("*")).toBe("\\*")
	})
})


describe("getFirstArg", function() {
	var fun = vashStatic.getFirstArg
    
    it("should get the name of the 'home' from the command-line argument", function(done) {
        
        // just using 'nothing.js' as an example to test command-line code
        var childProcess = exec('node test-resources/nothing.js --home', function() {
            
            // gets args from exec child process
            var args = childProcess.spawnargs[ childProcess.spawnargs.length -1 ]

            // removes quotes at either end and turns it into an array
            args = args.replace(/"/g, '').split(" ")

            expect(fun(args)).toBe("home")
            done()
        })
    });
})


describe("validatePageTemplate", function() {
	var fun = vashStatic.testable.validatePageTemplate

	it("should validate existant file", function(){
		expect(fun( TEST_RES + "simple.vash" )).toBe(true)
	})
    
	it("should invalidate non-existant file", function(){
		expect(fun( TEST_RES + "non-existant.txt" )).toBe(false)
	})
})


describe("getVinylDetails", function() {
	var fun = vashStatic.testable.getVinylDetails

    var vinylTmpl = getTemplateFile(aboutTmpl)

	it("should get details from a fake vinyl file", function() {
		var details = fun( vinylTmpl, ["pg"] )
        expect(details.fileName).toBe("Index.vash")
        expect(details.moduleName).toBe("about")
        expect(details.type).toBe("pg")
	})
})

describe("precompileTemplateCache", function() {
	var fun = vashStatic.precompile

    var vinylTmpl = getTemplateFile(aboutTmpl)

	it("should ensure a json file is created from the vash template source with the correct template name in it", function(done) {
        var pluginStream = fun({
            debugMode: true, 
            dirTypes: ["pg", "glb", "wg"], 
            modelsPath: TEST_RES + "models.js",
            cacheFileName: TEST_RES + "sample-template-cache.json"
        })
        
        pluginStream.write( vinylTmpl );
        pluginStream.end()

        // wait for the file to come back out
        pluginStream.once('data', function(file) {
            // make sure it came out the same way it went in
            expect(file.isBuffer()).toBe(true)

            var json = JSON.parse(file.contents.toString('utf8'))
		    expect(json["pg_about/Index"]).toBeDefined()

            done();
        });
	})
})

describe("renderPage", function() {
	var fun = vashStatic.renderPage

    var vinylTmpl = getTemplateFile(homeTmpl)

	it("should ensure a json file is created from the vash template source with the correct template name in it", function(done) {
        var pluginStream = fun({
            cacheDest: SAMPLE_CACHE
            , helpers: [ TEST_RES + "no-help.vash" ] // you can add or override (same name) with custom helpers
            , omitSubDir: "tmpl"
        })
        
        pluginStream.write( vinylTmpl );
        pluginStream.end()

        // wait for the file to come back out
        pluginStream.once('data', function(file) {
            // make sure it came out the same way it went in
            expect(file.isBuffer()).toBe(true)

            expect( file.contents.toString('utf8') ).toContain("<h1>Home Page</h1>")
            done();
        });
	})
})

/*
describe("XXXXX", function() {
	var fun = vashStatic.testable.XXXXX

	it("should ", function(){
		expect(fun("XXXXXX")).toBe("XXX")
	})
})
*/