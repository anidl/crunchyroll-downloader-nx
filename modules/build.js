#!/usr/bin/env node

// build requirements
const pkg = require('../package.json');
const fs = require('fs-extra');
const modulesCleanup = require('removeNPMAbsolutePaths');
const { exec } = require('pkg');

const buildsDir = './_builds';
const curNodeVer = 'node14-';

// main
(async function (){
    doBuild();
})();

// do build
async function doBuild(nodeVer){
    const buildStr = `${pkg.name}-${pkg.version}`;
    nodeVer = nodeVer ? nodeVer : '';
    const acceptableBuilds = ['win64','linux64','macos64'];
    const buildType = process.argv[2];
    if(!acceptableBuilds.includes(buildType)){
        console.error('[ERROR] unknown build type!');
        process.exit();
    }
    await modulesCleanup('.');
    if(!fs.existsSync(buildsDir)){
        fs.mkdirSync(buildsDir);
    }
    const buildFull = `${buildStr}-${buildType}`;
    const buildDir = `${buildsDir}/${buildFull}`;
    if(fs.existsSync(buildDir)){
        fs.removeSync(buildDir);
    }
    fs.mkdirSync(buildDir);
    const buildConfig = [ 
        pkg.main, 
        '--target', nodeVer + getTarget(buildType),
        '--output', `${buildDir}/${pkg.short_name}`,
    ];
    console.log(`[Build] Build configuration: ${buildFull}`);
    try {
        await exec(buildConfig);
    }
    catch(e){
        if(nodeVer == ''){
            await doBuild(curNodeVer);
        }
        process.exit();
    }
    fs.mkdirSync(`${buildDir}/bin`);
    fs.mkdirSync(`${buildDir}/config`);
    fs.mkdirSync(`${buildDir}/fonts`);
    fs.mkdirSync(`${buildDir}/videos`);
    fs.mkdirSync(`${buildDir}/videos/_trash`);
    fs.copySync('./config/bin-path.yml', `${buildDir}/config/bin-path.yml`);
    fs.copySync('./config/cli-defaults.yml', `${buildDir}/config/cli-defaults.yml`);
    fs.copySync('./config/dir-path.yml', `${buildDir}/config/dir-path.yml`);
    if(buildType == 'win64'){
        fs.copySync('./modules/cmd-here.bat', `${buildDir}/cmd-here.bat`);
    }
    fs.copySync('./docs/', `${buildDir}/docs/`);
    fs.copySync('./LICENSE.md', `${buildDir}/docs/LICENSE.md`);
    if(fs.existsSync(`${buildsDir}/${buildFull}.7z`)){
        fs.removeSync(`${buildsDir}/${buildFull}.7z`);
    }
    require('child_process').execSync(`7z a -t7z "${buildsDir}/${buildFull}.7z" "${buildDir}"`, {stdio:[0,1,2]});
    console.log('[LOG] Build ready:', `${buildsDir}/${buildFull}.7z`);
}

function getTarget(bt){
    switch(bt){
        case 'win64':
            return 'windows-x64';
        case 'linux64':
            return 'linux-x64';
        case 'macos64':
            return 'macos-x64';
        default:
            return 'windows-x64';
    }
}
