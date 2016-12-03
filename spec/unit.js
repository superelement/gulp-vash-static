var File = require('vinyl')
  , fs = require('fs-extra')
  , slash = require('slash')
  , _ = require('lodash')
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

beforeEach(function() {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;
});

afterEach(function() {
	fs.removeSync(TEMP_DIR);
})


xdescribe("regSlash", function() {
	var fun = vashStatic.testable.regSlash

	it("should escape common regular expression characters", function() {
		expect(fun("?")).toBe("\\?")
		expect(fun("*")).toBe("\\*")
	})
})


xdescribe("getAllArgs", function() {

	var fun = vashStatic.getAllArgs
    
    it("should get multiple page names from the faked command-line argument", function() {
        var result = fun(["--home", "--stuff"])
        expect(result).toContain("home");
        expect(result).toContain("stuff");
    });
})


xdescribe("overrideGetAllArgs and restoreGetAllArgs", function() {
    
    it("should override 'getAllArgs' function and return 'test', the restore the original.", function() {

        // override the function
        vashStatic.overrideGetAllArgs(function() {
            return 'test1';
        });
        
        expect( vashStatic.getAllArgs(["--test2"]) ).toBe("test1")
            
        // restores the original function for further tests
        vashStatic.restoreGetAllArgs();
        
        // tests working as normal after being restored
        expect( vashStatic.getAllArgs(["--test3"]) ).toContain("test3")
    });
})


xdescribe("validatePageTemplate", function() {
	var fun = vashStatic.testable.validatePageTemplate

	it("should validate existant file", function(){
		expect(fun( TEST_RES + "simple.vash" )).toBe(true)
	})
    
	it("should invalidate non-existant file", function(){
		expect(fun( TEST_RES + "non-existant.txt" )).toBe(false)
	})
})


xdescribe("getVinylDetails", function() {
	var fun = vashStatic.testable.getVinylDetails

    var vinylTmpl = getTemplateFile(aboutTmpl)

	it("should get details from a fake vinyl file", function() {
		var details = fun( vinylTmpl, ["pg"] )
        expect(details.fileName).toBe("Index.vash")
        expect(details.moduleName).toBe("about")
        expect(details.type).toBe("pg")
	})
})

xdescribe("precompileTemplateCache", function() {
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

xdescribe("renderPage", function() {
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

describe("watchModelsAndTemplates", function() {
	var fun = vashStatic.watchModelsAndTemplates;
    var THIS_TEMP_DIR = TEMP_DIR + "watchModelsAndTemplates/";
    var tempVashFilePath = THIS_TEMP_DIR + "pg/about/Index.vash";
    var tempModelsFilePath = THIS_TEMP_DIR + "models.js";
    var tempSourceModelFilePath = THIS_TEMP_DIR + "source-model.js";
    var tempPrecompiledCacheFilePath = THIS_TEMP_DIR + "example-cache.json";

    var opts = {
        gulp: null
        , vashSrc: [ tempVashFilePath ]
        , modelSrc: []
        , modelsDest: tempModelsFilePath
        , cacheDest: tempPrecompiledCacheFilePath
        , debugMode: true
        , dirTypes: ["pg"]
        , pageTemplatePath: THIS_TEMP_DIR + "<%= type %>/<%= moduleName %>/<%= fileName %>"

        // existing gulp tasks to call
        , combineModelsTask: null
        , precompileTask: null
        , pageRenderTask: 'example-render'
    }


    var prepTempFiles = function(isEmptyModel) {
        // creates temp files for test
        fs.copySync(aboutTmpl, tempVashFilePath);
        fs.outputFileSync(tempModelsFilePath, isEmptyModel ? "// empty models file" : TEST_RES + "models.js");
        fs.outputFileSync(tempSourceModelFilePath, "// something");
        fs.copySync(SAMPLE_CACHE, tempPrecompiledCacheFilePath);
        

        // needs to override `getAllArgs` so command-line args can be mocked
        vashStatic.overrideGetAllArgs(function() {
            return ["about/Index"];
        });
    }

	it("should watch a SINGLE vash template (without `modelSrc`, `combineModelsTask` and `precompileTask`) "+
        "and run the gulp task `pageRenderTask` after that file changes", function(done){
            
        prepTempFiles(true);

        var returnedStream;
        var gulp = require("gulp");
        
        // once example render gulp task has been called, close the stream and finish the test
        gulp.task('example-render', function() {
            if(returnedStream) {
                returnedStream.close();
                vashStatic.restoreGetAllArgs();
                done();
            }
        });

        var _opts = _.cloneDeep(opts);
        _opts.gulp = gulp;

		returnedStream = fun(_opts);

        // just replaces the vash file, to trigger the watch
        setTimeout(function() {
            fs.copySync(aboutTmpl, tempVashFilePath);
        }, 1000);
	})

    
	it("should watch a SINGLE vash template and model (with dummy `combineModelsTask`) "+
        "and run the gulp task `pageRenderTask` after model changes", function(done){
            
        prepTempFiles(true);

        var returnedStream
          , combinedModelsCalled = false

        var gulp = require("gulp");
        
        // once example render gulp task has been called, close the stream and finish the test
        gulp.task('example-render', function() {
            
            // needs `returnedStream` check because gets called once before watch takes place, but that shouldn't count
            if(returnedStream) {
                returnedStream.close();
                expect(combinedModelsCalled).toBe(true);
                vashStatic.restoreGetAllArgs();
                done();
            }
        });

        gulp.task('example-combine-models', function() {
            // needs `returnedStream` check because gets called once before watch takes place, but that shouldn't count
            if(returnedStream) combinedModelsCalled = true;
        });


        var _opts = _.cloneDeep(opts);
        _opts.gulp = gulp;
        _opts.combineModelsTask = 'example-combine-models';
        _opts.modelSrc = [ tempSourceModelFilePath ];

		returnedStream = fun(_opts);

        // just replaces the model js file, to trigger the watch
        setTimeout(function() {
            fs.outputFileSync(tempSourceModelFilePath, "// something else")
        }, 1000);
	})

    it("should watch MULTIPLE vash template and multiple models (with dummy `combineModelsTask`) "+
        "and run the gulp task `pageRenderTask` after model changes", function(done){
            
        prepTempFiles(true);

        var returnedStream
          , combinedModelsCalled = false
          , count = 0
          , total = 0;
        
        // extra vash template
        var tempHomeVashFilePath = THIS_TEMP_DIR + "pg/home/Index.vash";
        fs.copySync(homeTmpl, tempHomeVashFilePath);

        var tempSourceModel2FilePath = THIS_TEMP_DIR + "source-model2.js";
        fs.outputFileSync(tempSourceModel2FilePath, "// hi");

        var gulp = require("gulp");
        
        // once example render gulp task has been called, close the stream and finish the test
        gulp.task('example-render', function() {
            
            // needs `returnedStream` check because gets called once before watch takes place, but that shouldn't count
            if(returnedStream) {
                
                count++
                if(count === total) {
                    returnedStream.close();
                    expect(combinedModelsCalled).toBe(true);
                    vashStatic.restoreGetAllArgs();
                    done();
                }
            }
        });

        gulp.task('example-combine-models', function() {
            // needs `returnedStream` check because gets called once before watch takes place, but that shouldn't count
            if(returnedStream) 
                combinedModelsCalled = true;
        });

        var _opts = _.cloneDeep(opts);
        _opts.gulp = gulp;
        _opts.vashSrc = [ tempVashFilePath, tempHomeVashFilePath ];
        _opts.combineModelsTask = 'example-combine-models';
        _opts.modelSrc = [ tempSourceModelFilePath, tempSourceModel2FilePath ];

		returnedStream = fun(_opts);

        // Below we modify 2 models and 2 vash templates and expect the 'example-render' task to get called for each

        // just replaces the model JS file, to trigger the watch
        total++
        setTimeout(function() {
            fs.outputFileSync(tempSourceModelFilePath, "// something else")
        }, 1000);

        total++
        setTimeout(function() {
            fs.outputFileSync(tempSourceModel2FilePath, "// bye")
        }, 2000);
        
        // just replaces the vash file, to trigger the watch
        total++
        setTimeout(function() {
            fs.copySync(aboutTmpl, tempVashFilePath);
        }, 3000);

        total++
        setTimeout(function() {
            fs.copySync(homeTmpl, tempHomeVashFilePath);
        }, 4000);
	})
})
/*
xdescribe("XXXXX", function() {
	var fun = vashStatic.testable.XXXXX

	it("should ", function(){
		expect(fun("XXXXXX")).toBe("XXX")
	})
})
*/