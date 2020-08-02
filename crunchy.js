#!/usr/bin/env node

// build-in
const path = require('path');
const fs = require('fs');

// package program
const packageJson = require('./package.json');
console.log(`\n=== Crunchyroll Downloader NX ${packageJson.version} ===\n`);

// new-cfg
const cfgFolder = __dirname + '/config';
const binCfgFile = path.join(cfgFolder,'bin-path');
const dirCfgFile = path.join(cfgFolder,'dir-path');
const cliCfgFile = path.join(cfgFolder,'cli-defaults');
const sessCfgFile = path.join(cfgFolder,'session');

// plugins
const { lookpath } = require('lookpath');
const yargs = require('yargs');
const shlp = require('sei-helper');
const got = require('got');
const yaml = require('yaml');
const chio = require('cheerio');
const xhtml2js = shlp.xhtml2js;

// m3u8 and subs
const m3u8 = require('m3u8-parsed');
const streamdl = require('hls-download');
const modulesFolder = __dirname + '/modules';
const fontsData = require(modulesFolder+'/module.fontsData');
const crunchySubs = require(modulesFolder+'/module.crunchySubs');
const langsData = require(modulesFolder+'/module.langsData');

// get cfg file
function getYamlCfg(file, isSess){
    const ymlFile = fs.existsSync(`${file}.user.yml`) && !isSess
        ? `${file}.user.yml` : `${file}.yml`;
    if(fs.existsSync(ymlFile)){
        try{
            const cfgData = yaml.parse(fs.readFileSync(ymlFile, 'utf8'));
            return cfgData;
        }
        catch(e){
            return {};
        }
    }
    return {};
}

// params
const cfg = {
    bin: getYamlCfg(binCfgFile),
    dir: getYamlCfg(dirCfgFile),
    cli: getYamlCfg(cliCfgFile),
};

// custom
let session = getYamlCfg(sessCfgFile, true);

// args
let argv = yargs
    // main
    .wrap(Math.min(100))
    .usage('Usage: $0 [options]')
    .help(false).version(false)
    // auth
    .describe('auth','Enter auth mode')
    .describe('user','Username used for un-interactive authentication (Used with --auth)')
    .describe('pass','Password used for un-interactive authentication (Used with --auth)')
    // fonts
    .describe('dlfonts','Download all required fonts for mkv muxing')
    // search
    .describe('search','Search show ids')
    .alias('search','f')
    .describe('search2','Search show ids (multi-language, experimental)')
    .alias('search2','g')
    // req params
    .describe('s','Sets the show id')
    .describe('e','Select episode ids (comma-separated, hyphen-sequence)')
    // quality
    .describe('q','Video Quality')
    .choices('q',['240p','360p','480p','720p','1080p','max'])
    .default('q',(cfg.cli.videoQuality || '720p'))
    // set dub
    .describe('dub','Set audio language by language code (sometimes not detect correctly)')
    .choices('dub', langsData.isoLangs)
    .default('dub', (cfg.cli.dubLanguage || 'jpn'))
    // server
    .describe('kstream','Select specific stream')
    .choices('kstream', [1, 2, 3, 4, 5])
    .default('kstream', (cfg.cli.kStream || 1))
    .describe('x','Select server')
    .choices('x', [1, 2, 3, 4])
    .default('x', (cfg.cli.nServer || 1))
    .describe('tsparts','Download ts parts in batch')
    .choices('tsparts', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20])
    .default('tsparts', (cfg.cli.tsparts || 10))
    // old api
    .describe('oldstreams','Use old api for fetching stream')
    .boolean('oldstreams')
    .default('oldstreams', cfg.cli.oldStreams || false)
    .describe('oldsubs','Use old api for fetching subtitles')
    .boolean('oldsubs')
    .default('oldsubs', cfg.cli.oldSubs || false)
    // dl subs
    .describe('dlsubs','Download subtitles by language tag')
    .choices('dlsubs', langsData.subsLangsFilter)
    .default('dlsubs', (cfg.cli.dlSubs || 'all'))
    // skip
    .describe('skipdl','Skip downloading video (for downloading subtitles only)')
    .boolean('skipdl')
    .alias('skipdl','novids')
    .describe('skipmux','Skip muxing video and subtitles')
    .boolean('skipmux')
    // proxy
    .describe('proxy','Set http(s)/socks proxy WHATWG url')
    .default('proxy', (cfg.cli.proxy || false))
    .describe('proxy-auth','Colon-separated username and password for proxy')
    .default('proxy-auth', (cfg.cli.proxy_auth || false))
    .describe('ssp','Don\'t use proxy for stream and subtitles downloading')
    .boolean('ssp')
    .default('ssp', (cfg.cli.proxy_ssp || false))
    // muxing
    .describe('mp4','Mux into mp4')
    .boolean('mp4')
    .default('mp4',cfg.cli.mp4mux || false)
    // .describe('noaudsync','Set audio offset to 0ms')
    .boolean('noaudsync')
    .describe('mks','Add subtitles to mkv/mp4 (if available)')
    .boolean('mks')
    .default('mks',cfg.cli.muxSubs || false)
    // set title
    .describe('filename','Filenaming: Template')
    .default('filename', (cfg.cli.filenameTemplate || '[{rel_group}] {title} - {ep_num} [{suffix}]'))
    .describe('a','Filenaming: Release group')
    .default('a',cfg.cli.releaseGroup || 'CR')
    .describe('t','Filenaming: Series title override')
    .describe('ep','Filenaming: Episode number override (ignored in batch mode)')
    .describe('el','Filenaming: Episode number length')
    .choices('el', [1, 2, 3, 4])
    .default('el',cfg.cli.epNumLength || 2)
    .describe('suffix','Filenaming: Filename suffix override (first "SIZEp" will be replaced with actual video size)')
    .default('suffix',cfg.cli.fileSuffix || 'SIZEp')
    // util
    .describe('nocleanup','Move temporary files to trash folder instead of deleting')
    .boolean('nocleanup')
    .default('nocleanup',cfg.cli.noCleanUp || false)
    // help
    .describe('help','Show this help')
    .boolean('help')
    .alias('help','h')
    .argv;

// fn variables
let audDubT  = '',
    audDubE  = '',
    audDubP  = '',
    fnTitle  = '',
    fnEpNum  = '',
    fnSuffix = '',
    fnOutput = '',
    isBatch  = false,
    dlFailed = false,
    sxList   = [];

// api domains
const domain    = 'https://www.crunchyroll.com';
const apidomain = 'https://api.crunchyroll.com';

// api script urls
const api = {
    search1:     `${domain}/ajax/?req=RpcApiSearch_GetSearchCandidates`,
    search2:     `${domain}/search_page`,
    search3:     `${apidomain}/autocomplete.0.json`,
    session:     `${apidomain}/start_session.0.json`,
    collectins:  `${apidomain}/list_collections.0.json`,
    rss_cid:     `${domain}/syndication/feed?type=episodes&id=`, // &lang=enUS
    rss_gid:     `${domain}/syndication/feed?type=episodes&group_id=`, // &lang=enUS
    media_page:  `${domain}/media-`,
    series_page: `${domain}/series-`,
    subs_list:   `${domain}/xml/?req=RpcApiSubtitle_GetListing&media_id=`,
    subs_file:   `${domain}/xml/?req=RpcApiSubtitle_GetXml&subtitle_script_id=`,
    auth:        `${domain}/xml/?req=RpcApiUser_Login`,
    // ${domain}/showseriesmedia?id=24631
    // ${domain}/{GROUP_URL}/videos,
};

// set usable cookies
const usefulCookies = {
    auth: [ 
        'etp_rt',
        'c_visitor',
    ],
    sess: [ 
        'session_id',
    ],
};

(async () => {
    // select mode
    if(argv.auth){
        await doAuth();
    }
    else if(argv.dlfonts){
        await getFonts();
    }
    else if(argv.search && argv.search.length > 2){
        await doSearch();
    }
    else if(argv.search2 && argv.search2.length > 2){
        await doSearch2();
    }
    else if(argv.s && !isNaN(parseInt(argv.s,10)) && parseInt(argv.s,10) > 0){
        await getShowById();
    }
    else{
        yargs.showHelp();
    }
})();

// auth method
async function doAuth(){
    console.log('[INFO] Authentication');
    const iLogin = argv.user ? argv.user : await shlp.question('[Q] LOGIN/EMAIL');
    const iPsswd = argv.pass ? argv.pass : await shlp.question('[Q] PASSWORD   ');
    const authData = new URLSearchParams({
        name: iLogin,
        password: iPsswd
    });
    let auth = await getData(api.auth,{ method: 'POST', body: authData.toString(), useProxy: true, skipCookies: true });
    if(!auth.ok){
        console.log('[ERROR] Authentication failed!');
        if(auth.error && auth.error.res && auth.error.res.body){
            console.log('[AUTH] Body:', auth.error.res.body);
        }
        return;
    }
    setNewCookie(auth.res.headers['set-cookie'], true);
    console.log('[INFO] Authentication successful!');
}

// get cr fonts
async function getFonts(){
    console.log('[INFO] Downloading fonts...');
    for(let f of Object.keys(fontsData.fonts)){
        let fontFile = fontsData.fonts[f];
        let fontLoc  = path.join(cfg.dir.fonts, fontFile);
        if(fs.existsSync(fontLoc) && fs.statSync(fontLoc).size != 0){
            console.log(`[INFO] ${f} (${fontFile}) already downloaded!`);
        }
        else{
            if(fs.existsSync(fontLoc) && fs.statSync(fontLoc).size == 0){
                fs.unlinkSync(fontLoc);
            }
            let fontUrl = fontsData.root + fontFile;
            let getFont = await getData(fontUrl, { useProxy: true, skipCookies: true, binary: true });
            if(getFont.ok){
                fs.writeFileSync(fontLoc, getFont.res.body);
                console.log(`[INFO] Downloaded: ${f} (${fontFile})`);
            }
            else{
                console.log(`[WARN] Failed to download: ${f} (${fontFile})`);
            }
        }
    }
    console.log('[INFO] All required fonts downloaded!');
}

async function doSearch(){
    // session
    let apiSession = '';
    if(session.session_id && checkSessId(session.session_id) && !argv.nosess){
        apiSession = session.session_id.value;
    }
    // seacrh params
    const params = new URLSearchParams({
        q: argv.search,
        clases: 'series',
        media_types: 'anime',
        fields: 'series.series_id,series.name,series.year',
        offset: argv.p ? (parseInt(argv.p)-1)*100 : 0,
        limit: 100,
        locale: 'enUS',
    });
    if(apiSession != ''){
        params.append('session_id', apiSession);
    }
    else{
        const crDevices = {
            win10: {
                device_type:  'com.crunchyroll.windows.desktop',
                access_token: 'LNDJgOit5yaRIWN',
            },
            android: {
                device_type: 'com.crunchyroll.crunchyroid',
                access_token: 'WveH9VkPLrXvuNm',
            },
        };
        const sessionParams = new URLSearchParams({
            device_type:  crDevices.win10.device_type,
            device_id  :  '00000000-0000-0000-0000-000000000000',
            access_token:  crDevices.win10.access_token,
        });
        let reqSession = await getData(`${api.session}?${sessionParams.toString()}`,{useProxy:true});
        if(!reqSession.ok){
            console.log('[ERROR] Can\'t update session id!');
            return;
        }
        reqSession = JSON.parse(reqSession.res.body);
        if(reqSession.error){
            console.log(`[ERROR] ${aniList.message}`);
        }
        else{
            argv.nosess = false;
            console.log(`[INFO] Your country: ${reqSession.data.country_code}\n`);
            apiSession = session.session_id.value;
            params.append('session_id', apiSession);
        }
    }
    // request
    let aniList = await getData(`${api.search3}?${params.toString()}`,{useProxy:true});
    if(!aniList.ok){
        console.log('[ERROR] Can\'t get search data!');
        return;
    }
    aniList = JSON.parse(aniList.res.body);
    if(aniList.error){
        console.log(`[ERROR] ${aniList.message}`);
    }
    else{
        if(aniList.data.length > 0){
            console.log('[INFO] Search Results:');
            for(let a of aniList.data){
                await printSeasons(a,apiSession);
            }
            console.log(`\n[INFO] Total results: ${aniList.data.length}\n`);
        }
        else{
            console.log('[INFO] Nothing Found!');
        }
    }
}

async function printSeasons(a,apiSession){
    console.log(`[SERIES] #${a.series_id} ${a.name}`,(a.year?`(${a.year})`:''));
    let collParams = new URLSearchParams({
        session_id: apiSession,
        series_id:  a.series_id,
        fields:     'collection.collection_id,collection.name',
        limit:      5000,
        offset:     0,
        locale:     'enUS',
    });
    let seasonList = await getData(`${api.collectins}?${collParams.toString()}`,{useProxy:true});
    if(seasonList.ok){
        seasonList = JSON.parse(seasonList.res.body);
        if(seasonList.error){
            console.log(`  [ERROR] Can't fetch seasons list: ${seasonList.message}`);
        }
        else{
            if(seasonList.data.length>0){
                for(let s of seasonList.data){
                    console.log(`  [S:${s.collection_id}] ${s.name}`);
                }
            }
            else{
                console.log('  [ERROR] Seasons list is empty');
            }
        }
    }
    else{
        console.log('  [ERROR] Can\'t fetch seasons list (request failed)');
    }
}

async function doSearch2(){
    // search params
    const params = new URLSearchParams({
        q: argv.search2,
        sp: argv.p ? parseInt(argv.p) - 1 : 0,
        limit: 100,
        st: 'm'
    });
    // request
    let reqAniSearch  = await getData(`${api.search2}?${params.toString()}`,{useProxy:true});
    if(!reqAniSearch.ok){ return; }
    let reqRefAniList = await getData(`${api.search1}`,{useProxy:true});
    if(!reqRefAniList.ok){ return; }
    // parse fix
    let aniSearchSec  = reqAniSearch.res.body.replace(/^\/\*-secure-\n(.*)\n\*\/$/,'$1');
    let aniRefListSec = reqRefAniList.res.body.replace(/^\/\*-secure-\n(.*)\n\*\/$/,'$1');
    aniSearchSec = JSON.parse(aniSearchSec);
    aniRefListSec = JSON.parse(aniRefListSec);
    let totalResults = 0;
    // data
    const mainHtml = xhtml2js({ src: '<html>'+aniSearchSec.data.main_html+'</html>', el: 'body' }).$;
    const results0 = mainHtml.find('p');
    const results1 = results0.eq(0).text().trim();
    const results2 = results0.eq(1).text().trim();
    const resultsStr = results2 != '' ? results2 :
        results1 != '' ? results1 : 'NOTHING FOUND!';
    console.log(`[INFO] ${resultsStr}`);
    // seasons
    const searchData = mainHtml.find('li');
    for(let v=0; v<searchData.length; v++){
        let href  = searchData.eq(v).find('a')[0].attribs.href;
        let data  = aniRefListSec.data.filter(value => value.link == href).shift();
        let notLib = href.match(/^\/library\//) ? false : true;
        if(notLib && data && data.type == 'Series'){
            if(session.session_id && checkSessId(session.session_id) && !argv.nosess){
                await printSeasons({series_id: data.id, name: data.name},session.session_id.value);
            }
            else{
                console.log('  [ERROR] Can\'t fetch seasons list, session_id cookie required');
            }
            totalResults++;
        }
        if(notLib && !data){
            console.log('[SERIES] #??????',href.replace(/^\//,'').replace(/-/g,' '));
            console.log('  [ERROR] Can\'t fetch seasons list, not listed in search data');
            console.log(`  [ERROR] URL: ${domain}${href}`);
            totalResults++;
        }
    }
    if(totalResults>0){
        console.log('[INFO] Non-anime results is hidden');
        console.log(`[INFO] Total results: ${totalResults}\n`);
    }
}

async function getShowById(){
    // request episode list
    const epListRss = `${api.rss_cid}${argv.s}`;
    const epListReq = await getData(epListRss,{useProxy:true});
    // request failed
    if(!epListReq.ok){ return 0; }
    // set data
    const epListBody = epListReq.res.body;
    const epListXML = xhtml2js({ src: epListBody, el: 'channel', isXml: true }).$;
    // set and show main title // image title
    const showTitle = (
        epListXML.find('image title').eq(0).text()
            ? epListXML.find('image title').eq(0).text()
            : epListXML.find('title').eq(0).text().replace(/ Episodes$/i,'')
    );
    const isSimul   = epListXML.find('crunchyroll\\:simulcast').length > 0 ? true : false;
    // if dubbed title
    if(showTitle.match(langsData.dubRegExp)){
        audDubT = langsData.dubLangs[showTitle.match(langsData.dubRegExp)[1]];
        console.log(`[INFO] audio language code detected, setted to ${audDubT} for this title`);
    }
    // display title
    console.log(`[S:${argv.s}] ${showTitle}`,(isSimul?'[simulcast]':''));
    // parse list
    const titleEpsList = { media: {}, episodes: [], specials: [], meta: {} };
    const epsList  = epListXML.find('item');
    const vdsCount = epsList.length;
    const dateNow = Date.now() + 1;
    // st num length
    const epNumLen = { E: 4, S: 3, M: 6 };
    // create list
    epsList.each((idx)=>{
        // set index
        idx = isSimul ? vdsCount - idx - 1 : idx;
        // add eps nums
        const videoTitleData = {
            season:    showTitle,
            episodeNo: epsList.eq(idx).find('crunchyroll\\:episodeNumber').text(),
            episode:   epsList.eq(idx).find('crunchyroll\\:episodeTitle').text(),
        };
        let epNumStr = videoTitleData.episodeNo;
        let epNum = epNumStr;
        epNum = epNum.match(/^\d+$/) ? epNum.padStart(epNumLen['E'], '0') : epNum;
        if(titleEpsList.episodes.indexOf(epNum) > -1 || !epNum.match(/^\d+$/) ){
            epNum = 'S' + (titleEpsList.specials.length + 1).toString().padStart(epNumLen['S'], '0');
            titleEpsList.specials.push(epNum);
        }
        else{
            titleEpsList.episodes.push(epNum);
        }
        // add media-episode relation
        let mediaId = epsList.eq(idx).find('crunchyroll\\:mediaId').text();
        let mediaIdPad = mediaId.padStart(epNumLen['M'],'0');
        let epType = epNum.match('S') ? 'specials' : 'episodes';
        titleEpsList.media[mediaIdPad] = `${epType}:${titleEpsList[epType].length-1}`;
        // episode info
        let ssTitle = videoTitleData.season;
        let epTitle = videoTitleData.episode;
        let airDate = new Date(epsList.eq(idx).find('crunchyroll\\:premiumPubDate').text());
        let airFree = new Date(epsList.eq(idx).find('crunchyroll\\:freePubDate').text());
        let subsArr = epsList.eq(idx).find('crunchyroll\\:subtitleLanguages').text();
        // add data
        titleEpsList.meta[mediaIdPad] = {
            m:  mediaId,
            t:  ssTitle,
            e:  epNumStr,
            te: epTitle,
        };
        // print info
        let listEpTitle = '';
        listEpTitle += epNumStr ? epNumStr : '';
        listEpTitle += epNumStr && epTitle ? ' - ' : '';
        listEpTitle += epTitle ? epTitle : '';
        listEpTitle = listEpTitle ? listEpTitle : 
            epsList.eq(idx).find('title').text();
        console.log(`  [${epNum}|${mediaIdPad}] ${listEpTitle}`);
        // print dates
        let dateStrPrem = shlp.dateString(airDate)
            + ( dateNow < airDate ? ` (in ${shlp.formatTime((airDate-dateNow)/1000)})` : '');
        let dateStrFree = shlp.dateString(airFree)
            + ( dateNow < airFree ? ` (in ${shlp.formatTime((airFree-dateNow)/1000)})` : '');
        console.log(`   - PremPubDate: ${dateStrPrem}`);
        console.log(`   - FreePubDate: ${dateStrFree}`);
        // subtitles
        if(subsArr){
            console.log(`   - Subtitles: ${langsData.parseRssSubsString(subsArr)}`);
        }
    });
    
    let inputEps = typeof argv.e != 'undefined'
        ? argv.e.toString().split(',') : [];
    let inputEpsRange = [];
    
    if(inputEps.length<1){
        console.log('\n[INFO] Episodes not selected!\n');
        return;
    }
    
    // selectors
    const selData = { media: [], eps: [] };
    const epRexVr = `^(?:E?\\d{1,${epNumLen['E']}}|S\\d{1,${epNumLen['S']}}|M\\d{1,${epNumLen['M']}})$`;
    const epRegex = new RegExp (epRexVr);
    
    // const filter wrong numbers
    inputEps = inputEps.map((e)=>{
        // conver to uppercase
        e = e.toUpperCase();
        // if range
        if(e.match('-') && e.split('-').length == 2){
            let eRange = e.split('-');
            let mch1 = eRange[0].match(epRegex);
            if (!mch1) return '';
            let epLetter = eRange[0].match(/(?:E|S|M)/) ? eRange[0].match(/(?:E|S|M)/)[0] : 'E';
            let mch2 = eRange[1].match(new RegExp (`^\\d{1,${epNumLen[epLetter]}}$`));
            if (!mch2) return '';
            eRange[0] = eRange[0].replace(/(?:E|S|M)/,'');
            eRange[0] = parseInt(eRange[0]);
            eRange[1] = parseInt(eRange[1]);
            if (eRange[0] > eRange[1]) return epLetter + eRange[0];
            let rangeLength = eRange[1] - eRange[0] + 1;
            let epsRangeArr = Array(rangeLength).fill(0).map((x, y) => x + y + eRange[0]);
            epsRangeArr.forEach((i)=>{
                let selEpStr = epLetter + i.toString().padStart(epNumLen[epLetter],'0');
                inputEpsRange.push(selEpStr);
            });
            return '';
        }
        else if(e.match(epRegex)){
            return e;
        }
        return '';
    });
    // remove empty and duplicates
    inputEps = [...new Set(inputEps.concat(inputEpsRange))];
    const mediaList = Object.keys(titleEpsList.media).sort();
    // select episodes
    inputEps.map((e)=>{
        if(e.match(/M/)){
            e = e.replace(/M/,'').padStart(epNumLen['M'],'0');
            if(selData.media.indexOf(e) > -1) return '';
            let idx = mediaList.indexOf(e);
            if(idx > -1 && selData.media.indexOf(e) < 0 ){
                let epArr = titleEpsList.media[e].split(':');
                selData.eps.push(titleEpsList[epArr[0]][epArr[1]]);
                selData.media.push(e);
            }
        }
        else{
            if(e == '') return '';
            let eLetter = e.match(/S/) ? 'S' : 'E';
            e = (eLetter == 'S' ? 'S' : '') + e.replace(/E|S/,'').padStart(epNumLen[eLetter],'0');
            if(selData.eps.indexOf(e) > -1) return '';
            let seqArr = eLetter == 'S' ? 'specials' : 'episodes';
            let seqIdx = titleEpsList[seqArr].indexOf(e);
            if(seqIdx > -1){
                let idx = Object.values(titleEpsList.media).indexOf(`${seqArr}:${seqIdx}`);
                let msq = mediaList[idx];
                if(selData.media.indexOf(msq) < 0){
                    selData.media.push(msq);
                    selData.eps.push(e);
                }
            }
        }
    });
    // display
    if(selData.eps.length<1){
        console.log('\n[INFO] Episodes not selected!\n');
        return;
    }
    selData.eps.sort();
    console.log('\n[INFO] Selected Episodes:',selData.eps.join(', ')+'\n');
    const selMedia = selData.media;
    // start selecting from list
    if(selMedia.length > 0){
        for(let sm=0;sm<selMedia.length;sm++){
            await getMedia(titleEpsList.meta[selMedia[sm]]);
        }
    }
}

async function getMedia(mMeta){
    
    console.log(`Requesting: [${mMeta.m}] ${mMeta.t} - ${mMeta.e} - ${mMeta.te}`);
    
    const mediaPage = await getData(`${api.media_page}${mMeta.m}`,{useProxy:true});
    if(!mediaPage.ok){
        console.log('[ERROR] Failed to get video page!');
        return;
    }
    
    audDubE = '';
    if(audDubT == '' && mMeta.te.match(langsData.dubRegExp)){
        audDubE = langsData.dubLangs[mMeta.te.match(langsData.dubRegExp)[1]];
        console.log(`[INFO] audio language code detected, setted to ${audDubE} for this episode`);
    }
    
    const contextData = mediaPage.res.body.match(/({"@context":.*)(<\/script>)/);
    const eligibleRegion = JSON.parse(contextData[1]).potentialAction
        .actionAccessibilityRequirement.eligibleRegion;
    
    const vHtml = chio.load(mediaPage.res.body);
    const ccEl = vHtml('#footer_country_flag');
    
    const ccLocUserArr = ccEl.attr('src').split('/');
    const ccLocUser = ccLocUserArr[ccLocUserArr.length-1].split('.')[0].toUpperCase();
    console.log('[INFO] Your region:', ccLocUser, ccEl.attr('alt'));
    
    const userDetect = mediaPage.res.body.match(/\$\.extend\(traits, (.*)\);/);
    const curUser = userDetect ? JSON.parse(userDetect[1]) : {'username': 'anonimous'};
    console.log('[INFO] Your account:', curUser.username, '\n');
    
    const availDetect = eligibleRegion.filter((r)=>{ return r.name == ccLocUser; });
    const isAvailVideo = availDetect.length > 0 ? true : false;
    
    // page msgs
    let msgItems = mediaPage.res.body.match(/Page.messaging_box_controller.addItems\((.*)\);/);
    msgItems = msgItems ? JSON.parse(msgItems[1]) : [];
    msgItems.map(m => {
        m.type = m.type.toUpperCase();
        return m;
    });
    let msgHasErrors = msgItems.filter(m => m.type == 'ERROR').length > 0 ? true : false;
    if(msgItems.length > 0 && argv.pagemsgs || msgItems && msgHasErrors){
        let msgItemsArr = [];
        console.log('[INFO] PAGE MSGs:');
        for(let m of msgItems){
            msgItemsArr.push(`  [${m.type}] ${m.message_body.replace(/<[^>]*>?/gm, '')}`);
        }
        msgItemsArr = [...new Set(msgItemsArr)];
        console.log(msgItemsArr.join('\n'),'\n');
    }
    // --
    
    let mediaData = mediaPage.res.body.match(/vilos.config.media = \{(.*)\};/);
    if(!mediaData && !argv.oldsubs && !isAvailVideo){
        console.log('[ERROR] VIDEO NOT AVAILABLE FOR YOUR REGION!');
        return;
    }
    else if(!mediaData && !argv.oldsubs){
        console.log('[ERROR] CAN\'T DETECT VIDEO INFO / PREMIUM LOCKED FOR YOUR REGION?');
        return;
    }
    else if(!mediaData){
        // Need for getting oldsubs for premium locked
    }
    else{
        mediaData = mediaData[1];
        mediaData = JSON.parse(`{${mediaData}}`);
        if(argv.debug){
            console.log('[DEBUG]', mediaData);
        }
    }
    
    let epNum = mMeta.e;
    let metaEpNum = mediaData ? mediaData.metadata.episode_number : epNum.replace(/^E/,'');
    if(metaEpNum != '' && metaEpNum !== null){
        epNum = metaEpNum.match(/^\d+$/) ? metaEpNum.padStart(argv.el,'0') : metaEpNum;
    }
    
    if(typeof argv.q == 'object' && argv.q.length > 1){
        argv.q = argv.q[argv.q.length-1];
    }
    
    fnTitle = argv.t ? argv.t : mMeta.t;
    fnEpNum = !isBatch && argv.ep ? argv.ep : epNum;
    fnSuffix = argv.suffix.replace('SIZEp',argv.q);
    fnOutput = fnOutputGen();
    
    let streams    = mediaData ? mediaData.streams : [],
        streamKey  = '';
    let isClip     = false,
        hlsStream  = '',
        getOldSubs = false;
    
    if(argv.oldstreams){
        let videoSrcStr = mediaPage.res.body.match(/<link rel="video_src" href="(.*)" \/>/);
        if(videoSrcStr){
            isClip = true;
            let parseCfg    = new URL(videoSrcStr[1]).searchParams;
            let parseCfgUrl = parseCfg.get('config_url') + '&current_page=' + domain;
            let streamData = await getData(parseCfgUrl.replace(/http:/, 'https:'), {useProxy: argv.ssp});
            if(streamData.ok){
                let videoDataBody = streamData.res.body.replace(/\n/g,'').replace(/ +/g,' ');
                let xmlMediaId    = videoDataBody.match(/<media_id>(\d+)<\/media_id>/);
                let xmlFileUrl    = videoDataBody.match(/<file>(.*)<\/file>/);
                let xmlError      = videoDataBody.match(/<error>(.*)<\/error>/);
                let countdown     = videoDataBody.match(/<countdown_seconds>(\d+)<\/countdown_seconds>/);
                if(countdown && countdown[1] && countdown[1] > 0){
                    console.log('[INFO] Episode not aired yet!');
                    return;
                }
                if(xmlMediaId && xmlMediaId[1] && xmlMediaId[1] != mMeta.m){
                    mMeta.m = xmlMediaId[1];
                }
                if(xmlFileUrl && xmlFileUrl[1]){
                    streamKey = 'api_hls';
                    hlsStream = xmlFileUrl[1].replace(/&amp;/g,'&');
                    console.log('[INFO] Full raw stream found!');
                }
                else if(xmlError && xmlError[1]){
                    isClip = false;
                    let xmlErrorData = xmlError[1].trim().match(/<code>(\d+)<\/code>(.*)<msg>(.*)<\/msg>/);
                    console.log(`[ERROR] CODE ${xmlErrorData[1]}: ${xmlErrorData[3]}`);
                }
            }
        }
    }
    else if(streams.length>0){
        let hlsStreams = {};
        let hlsStreamIndex = 1;
        // streams.reverse();
        for(let s in streams){
            let isHls = streams[s].format.match(/hls/)
                && !streams[s].format.match(/drm/) ? true : false;
            let checkParams = isHls && streams[s].hardsub_lang === null;
            if(streams[s].url.match(/clipFrom/)){
                isClip = true;
            }
            if(checkParams && !isClip){
                let sKeyStr = `${streams[s].format}/${streams[s].audio_lang}`;
                hlsStreams[sKeyStr] = streams[s].url;
                console.log(`[INFO] Full raw stream found! (${hlsStreamIndex}: ${sKeyStr})`);
                hlsStreamIndex++;
            }
        }
        let hlsStreamKeys     = Object.keys(hlsStreams);
        if(hlsStreamKeys.length>0){
            argv.kstream = argv.kstream > hlsStreamKeys.length ? 1 : argv.kstream;
            for(let k in hlsStreamKeys){
                k = parseInt(k);
                if(hlsStream == '' || argv.kstream == k + 1){
                    streamKey = hlsStreamKeys[k];
                    hlsStream = hlsStreams[streamKey];
                }
            }
        }
        else{
            hlsStream = '';
        }
    }
    else{
        console.log('[WARN] No streams found!');
    }
    
    if(argv.nullstream){
        hlsStream = '';
    }
    
    // reset playlist
    audDubP = '';
    
    // download stream
    if(!isAvailVideo){
        console.log('[ERROR] No available full raw stream! Video not available for your region!');
        argv.skipmux = true;
    }
    else if(hlsStream == '' && !isClip){
        console.log('[ERROR] No available full raw stream! Session expired?');
        argv.skipmux = true;
    }
    else if(hlsStream == '' && isClip){
        console.log('[ERROR] No available full raw stream! Only clip streams available.');
        argv.skipmux = true;
    }
    else{
        // get
        console.log('[INFO] Downloading video...');
        let streamKeyStr = streamKey != '' ? `(${streamKey})` : '';
        let streamUrlTxt = argv.ssu ? hlsStream : '';
        // check lng
        let streamDubLang = typeof streamKey == 'string' ? streamKey.split('/') : '';
        if(streamDubLang[1] && langsData.langCodes[streamDubLang[1]]){
            let PlAudioLang = langsData.langCodes[streamDubLang[1]];
            if(audDubT == '' && audDubE == '' && PlAudioLang.code != argv.dub){
                audDubP = PlAudioLang.code;
                console.log(`[INFO] audio language code detected, setted to ${PlAudioLang.lang} for this episode`);
            }
        }
        // request
        console.log('[INFO] Playlist URL:', streamUrlTxt, streamKeyStr);
        let streamPlaylist = await getData(hlsStream, {useProxy: argv.ssp});
        if(!streamPlaylist.ok){
            console.log(streamPlaylist);
            console.log('[ERROR] CAN\'T FETCH VIDEO PLAYLISTS!');
            dlFailed = true;
        }
        else{
            // parse
            let plQualityLinkList = m3u8(streamPlaylist.res.body);
            // main servers
            let mainServersList = [
                'v.vrv.co',
                'a-vrv.akamaized.net'
            ];
            // variables
            let plServerList = [],
                plStreams    = {},
                plQualityStr = [],
                plMaxQuality = 240;
            // set variables
            for(let s of plQualityLinkList.playlists){
                let plResolution = s.attributes.RESOLUTION.height;
                let plResText    = `${plResolution}p`;
                plMaxQuality = plMaxQuality < plResolution ? plResolution : plMaxQuality;
                let plUrlDl  = s.uri;
                let plServer = plUrlDl.split('/')[2];
                if(!plServerList.includes(plServer)){
                    plServerList.push(plServer);
                }
                if(!Object.keys(plStreams).includes(plServer)){
                    plStreams[plServer] = {};
                }
                if(plStreams[plServer][plResText] && plStreams[plServer][plResText] != plUrlDl){
                    console.log(`[WARN] Non duplicate url for ${plServer} detected, please report to developer!`);
                }
                else{
                    plStreams[plServer][plResText] = plUrlDl;
                }
                // set plQualityStr
                let plBandwidth  = Math.round(s.attributes.BANDWIDTH/1024);
                if(plResolution<1000){
                    plResolution = plResolution.toString().padStart(4,' ');
                }
                let qualityStrAdd   = `${plResolution}p (${plBandwidth}KiB/s)`;
                let qualityStrRegx  = new RegExp(qualityStrAdd.replace(/(:|\(|\)|\/)/g,'\\$1'),'m');
                let qualityStrMatch = !plQualityStr.join('\r\n').match(qualityStrRegx);
                if(qualityStrMatch){
                    plQualityStr.push(qualityStrAdd);
                }
            }
            
            for(let s of mainServersList){
                if(plServerList.includes(s)){
                    plServerList.splice(plServerList.indexOf(s),1);
                    plServerList.unshift(s);
                    break;
                }
            }
            
            argv.q = argv.q == 'max' ? `${plMaxQuality}p` : argv.q;
            
            let plSelectedServer = plServerList[argv.x-1];
            let plSelectedList   = plStreams[plSelectedServer];
            let videoUrl = argv.x < plServerList.length+1 && plSelectedList[argv.q] ? plSelectedList[argv.q] : '';
            
            plQualityStr.sort();
            console.log(`[INFO] Servers available:\n\t${plServerList.join('\n\t')}`);
            console.log(`[INFO] Available qualities:\n\t${plQualityStr.join('\n\t')}`);
            
            if(videoUrl != ''){
                console.log(`[INFO] Selected quality: ${argv.q} @ ${plSelectedServer}`);
                if(argv.ssu){
                    console.log('[INFO] Stream URL:',videoUrl);
                }
                // filename
                fnSuffix = argv.suffix.replace('SIZEp',argv.q);
                fnOutput = fnOutputGen();
                console.log(`[INFO] Output filename: ${fnOutput}`);
                if(argv.skipdl){
                    console.log('[INFO] Video download skipped!\n');
                }
                else{
                    // request
                    let chunkPage = await getData(videoUrl,{useProxy: argv.ssp});
                    if(!chunkPage.ok){
                        console.log('[ERROR] CAN\'T FETCH VIDEO PLAYLIST!');
                        argv.skipmux = true;
                    }
                    else{
                        let chunkList = m3u8(chunkPage.res.body);
                        chunkList.baseUrl = videoUrl.split('/').slice(0, -1).join('/')+'/';
                        // proxy
                        let proxyHLS = false;
                        if(argv.proxy && !argv.ssp){
                            try{
                                proxyHLS = {};
                                proxyHLS.url = buildProxy(argv.proxy, argv['proxy-auth']);
                                proxyHLS.url = proxyHLS.url.toString();
                            }
                            catch(e){
                                console.log(`\n[WARN] Not valid proxy URL${e.input?' ('+e.input+')':''}!`);
                                console.log('[WARN] Skiping...');
                                proxyHLS = false;
                            }
                        }
                        console.log('[INFO] Total parts in stream:', chunkList.segments.length);
                        let tsFile = path.join(cfg.dir.content, fnOutput);
                        let streamdlParams = {
                            fn: `${tsFile}.ts`,
                            m3u8json: chunkList,
                            baseurl: chunkList.baseUrl,
                            pcount: argv.tsparts,
                            partsOffset: 0,
                            proxy: ( proxyHLS ? proxyHLS : false),
                        };
                        let dldata = await new streamdl(streamdlParams).download();
                        if(!dldata.ok){
                            fs.writeFileSync(`${tsFile}.ts.resume`, JSON.stringify(dldata.parts));
                            console.log(`[ERROR] DL Stats: ${JSON.stringify(dldata.parts)}\n`);
                            dlFailed = true;
                        }
                        else if(fs.existsSync(`${tsFile}.ts.resume`) && dldata.ok){
                            fs.unlinkSync(`${tsFile}.ts.resume`);
                        }
                    }
                }
            }
            else if(argv.x > plServerList.length){
                console.log('[ERROR] Server not selected!\n');
                dlFailed = true;
            }
            else{
                console.log('[ERROR] Quality not selected!\n');
                dlFailed = true;
            }
        }
    }
    
    // get old subs
    getOldSubs = argv.oldsubs;
    
    // oldsubs warning
    if(getOldSubs){
        console.log('[WARN] oldsubs cli option is broken, see issue #2 at github');
        // argv.oldsubs = false;
    }
    
    // fix max quality for non streams
    if(argv.q == 'max'){
        argv.q = '1080p';
        fnSuffix = argv.suffix.replace('SIZEp',argv.q);
        fnOutput = fnOutputGen();
    }
    
    // download subs
    sxList = [];
    if(!argv.skipsubs && argv.dlsubs != 'none'){
        console.log('[INFO] Downloading subtitles...');
        if(!getOldSubs && mediaData.subtitles.length < 1){
            console.log('[WARN] Can\'t find urls for subtitles!');
        }
        if(getOldSubs){
            let mediaIdSubs = mMeta.m;
            console.log('[INFO] Trying get subtitles in old format...');
            if(hlsStream == '' && !argv.oldstreams){
                let reqParams = new URLSearchParams({
                    req:          'RpcApiVideoPlayer_GetStandardConfig',
                    media_id:      mMeta.m,
                    video_format:  106,
                    video_quality: 61,
                    aff:           'crunchyroll-website',
                    current_page:  domain
                });
                let streamData = await getData(`${domain}/xml/?${reqParams.toString()}`,{useProxy:true});
                if(!streamData.ok){
                    console.log(streamData);
                    mediaIdSubs = 0;
                }
                else{
                    mediaIdSubs = streamData.res.body.match(/<media_id>(\d+)<\/media_id>/);
                    mediaIdSubs = mediaIdSubs[1];
                }
            }
            mediaIdSubs = parseInt(mediaIdSubs);
            if(mediaIdSubs > 0){
                let subsListApi = await getData(`${api.subs_list}${mediaIdSubs}`);
                if(subsListApi.ok){
                    // parse list
                    let subsListXml = xhtml2js({
                        src: subsListApi.res.body,
                        el: 'subtitles',
                        isXml: true,
                        parse: true,
                    }).data.children;
                    // subsDecrypt
                    let oldSubsData = [];
                    for(let s of subsListXml){
                        if(s.tagName == 'subtitle'){
                            let subsId = s.attribs.id;
                            let subsPreTitle = s.attribs.title;
                            let subsXmlApi = await getData(`${api.subs_file}${subsId}`, {useProxy: argv.ssp});
                            if(subsXmlApi.ok){
                                let subXml      = crunchySubs.decrypt(null, subsXmlApi.res.body);
                                if(subXml.ok){
                                    let sxData = {};
                                    let sx = crunchySubs.parse(s.attribs, subXml.data);
                                    sxData.cl = langsData.langCodes[sx.language];
                                    sxData.langExtCode = sx.language;
                                    if(argv.dlsubs.includes('all') || argv.dlsubs.includes(sx.language)){
                                        console.log(`[INFO] Subtitle downloaded: #${subsId} ${subsPreTitle}`);
                                        sxData.src = sx.src;
                                        oldSubsData.push(sxData);
                                    }
                                    else{
                                        console.log(`[INFO] Subtitle download skipped: #${subsId} ${subsPreTitle}`);
                                    }
                                }
                                else{
                                    console.log(`[WARN] Failed decode subtitle: #${subsId} ${subsPreTitle}`);
                                    console.log(subXml.data);
                                }
                            }
                            else{
                                console.log(`[WARN] Failed to download subtitle: #${subsId} ${subsPreTitle}`);
                            }
                        }
                    }
                    if(oldSubsData.length > 0){
                        let oldSubsData = langsData.sortSubtitles(oldSubsData);
                        for(let si in oldSubsData){
                            let s = oldSubsData[si];
                            let sxData = {};
                            sxData.file = langsData.subsFile(fnOutput, si, s.cl);
                            sxData.langExtCode = s.langExtCode;
                            sxData.langCode = s.cl.code;
                            sxData.langStr = s.cl.local;
                            let sBody = '\ufeff' + s.src;
                            sxData.title = s.title;
                            sxData.fonts = fontsData.assFonts(sBody);
                            fs.writeFileSync(path.join(cfg.dir.content, sxData.file), sBody);
                            console.log(`[INFO] Subtitle saved: ${sxData.file}`);
                            sxList.push(sxData);
                        }
                    }
                    if(sxList.length < 1){
                        console.log('[WARN] Subs not found!');
                    }
                }
                else{
                    console.log('[WARN] Failed to get subtitles list using old api!');
                }
            }
            else{
                console.log('[ERROR] Can\'t get video id for subtitles list!');
            }
        }
        else if(mediaData.subtitles.length > 0){
            mediaData.subtitles = langsData.sortSubtitles(mediaData.subtitles);
            for(let si in mediaData.subtitles){
                let s = mediaData.subtitles[si];
                let cl = langsData.langCodes[s.language];
                let sxData = {};
                sxData.file = langsData.subsFile(fnOutput, si, cl);
                sxData.langExtCode = s.language;
                sxData.langCode = cl.code;
                sxData.langStr = cl.local;
                if(argv.dlsubs.includes('all') || argv.dlsubs.includes(s.language)){
                    let subsAssApi = await getData(s.url, {useProxy:  argv.ssp});
                    if(subsAssApi.ok){
                        let sBody = '\ufeff' + subsAssApi.res.body;
                        sxData.title = sBody.split('\r\n')[1].replace(/^Title: /, '');
                        sxData.fonts = fontsData.assFonts(sBody);
                        fs.writeFileSync(path.join(cfg.dir.content, sxData.file), sBody);
                        console.log(`[INFO] Subtitle downloaded: ${sxData.file}`);
                        sxList.push(sxData);
                    }
                    else{
                        console.log(`[WARN] Failed to download subtitle: ${sxData.file}`);
                    }
                }
            }
            if(sxList.length > 0){
                langsData.subsStr(sxList);
            }
        }
    }
    else{
        console.log('[INFO] Subtitles downloading skipped');
    }
    
    // go to muxing
    if(!argv.skipmux && !dlFailed){
        await muxStreams();
    }
    else{
        console.log();
    }
    
    dlFailed = false;
    return;
    
}

async function muxStreams(){
    // muxing video path prefix
    let muxFile = path.join(cfg.dir.content, fnOutput);
    // skip if no ts
    if(!fs.existsSync(`${muxFile}.ts`) || fs.existsSync(`${muxFile}.ts`) && fs.statSync(`${muxFile}.ts`).size == 0){
        console.log('[INFO] TS file not found, skip muxing video...\n');
        return;
    }
    // fix variables
    let audioDub;
    switch(true) {
        case (audDubT != ''):
            audioDub = audDubT;
            break;
        case (audDubE != ''):
            audioDub = audDubE;
            break;
        case (audDubP != ''):
            audioDub = audDubP;
            break;
        default:
            audioDub = argv.dub;
    }
    const addSubs = argv.mks && sxList.length > 0 ? true : false;
    // ftag
    argv.ftag = argv.ftag ? argv.ftag : argv.a;
    argv.ftag = shlp.cleanupFilename(argv.ftag);
    // usage
    let usableMKVmerge = true;
    let usableFFmpeg = true;
    // check exec path
    let mkvmergebinfile = await lookpath(path.join(cfg.bin.mkvmerge));
    let ffmpegbinfile   = await lookpath(path.join(cfg.bin.ffmpeg));
    // check exec
    if( !argv.mp4 && !mkvmergebinfile ){
        console.log('[WARN] MKVMerge not found, skip using this...');
        usableMKVmerge = false;
    }
    if( !usableMKVmerge && !ffmpegbinfile || argv.mp4 && !ffmpegbinfile ){
        console.log('[WARN] FFmpeg not found, skip using this...');
        usableFFmpeg = false;
    }
    // collect fonts info
    let fontsList = [];
    for(let s of sxList){
        fontsList = fontsList.concat(s.fonts);
    }
    fontsList = [...new Set(fontsList)];
    if(fontsList.length>0){
        console.log(`\n[INFO] Required fonts (${fontsList.length}):`,fontsList.join(', '));
    }
    // isMuxed
    let isMuxed = false;
    // mux
    if(!argv.mp4 && usableMKVmerge){
        // base
        let mkvmux  = [];
        // defaults
        mkvmux.push('--output',`${muxFile}.mkv`);
        mkvmux.push('--no-date','--disable-track-statistics-tags','--engage','no_variable_data');
        // video
        mkvmux.push('--track-name',`0:[${argv.ftag}]`);
        mkvmux.push('--language',`1:${audioDub}`);
        mkvmux.push('--video-tracks','0','--audio-tracks','1');
        mkvmux.push('--no-subtitles','--no-attachments');
        mkvmux.push(`${muxFile}.ts`);
        // subtitles
        if(addSubs){
            for(let t of sxList){
                let subsFile = path.join(cfg.dir.content, t.file);
                mkvmux.push('--track-name',`0:${t.langStr} / ${t.title}`);
                mkvmux.push('--language',`0:${t.langCode}`);
                mkvmux.push(`${subsFile}`);
            }
        }
        if(addSubs && fontsList.length>0){
            for(let f of fontsList){
                let fontFile = fontsData.fonts[f];
                if(fontFile){
                    let fontLoc  = path.join(cfg.dir.fonts, fontFile);
                    if(fs.existsSync(fontLoc) && fs.statSync(fontLoc).size != 0){
                        mkvmux.push('--attachment-name',fontFile);
                        mkvmux.push('--attach-file',fontLoc);
                    }
                }
            }
        }
        fs.writeFileSync(`${muxFile}.json`,JSON.stringify(mkvmux,null,'  '));
        try{
            shlp.exec('mkvmerge',`"${mkvmergebinfile}"`,`@"${muxFile}.json"`);
            isMuxed = true;
        }catch(e){}
    }
    else if(usableFFmpeg){
        let ffmux  = [], ffext = !argv.mp4 ? 'mkv' : 'mp4';
        let ffsubs = addSubs ? true : false;
        let ffmap = [], ffmeta = [];
        ffmux.push('-i',`"${muxFile}.ts"`);
        if(ffsubs){
            let ti = 0;
            for(let t of sxList){
                let subsFile = path.join(cfg.dir.content, t.file);
                ffmux.push('-i',`"${subsFile}"`);
                ffmap.push(`-map ${ti+1}`,'-c:s',(!argv.mp4?'copy':'mov_text'));
                ffmeta.push(`-metadata:s:s:${ti}`,`language=${t.langCode}`);
                ffmeta.push(`-metadata:s:s:${ti}`,`title="${t.langStr} / ${t.title}"`);
                ti++;
            }
        }
        ffmux.push('-map 0:0 -c:v copy');
        ffmux.push('-map 0:1 -c:a copy');
        ffmux = ffmux.concat(ffmap);
        if(ffsubs && ffext == 'mkv' && fontsList.length>0){
            let attIndex = 0;
            for(let f of fontsList){
                let fontFile = fontsData.fonts[f];
                if(fontFile){
                    let fontLoc  = path.join(cfg.dir.fonts, fontFile);
                    let fontMime = fontsData.fontMime(fontFile);
                    if(fs.existsSync(fontLoc) && fs.statSync(fontLoc).size != 0){
                        ffmux.push('-attach',`"${fontLoc}"`);
                        ffmeta.push(`-metadata:s:t:${attIndex}`,`mimetype="${fontMime}"`);
                        ffmeta.push(`-metadata:s:t:${attIndex}`,`filename="${fontFile}"`);
                        attIndex++;
                    }
                }
            }
        }
        ffmux.push('-metadata','encoding_tool="no_variable_data"');
        ffmux.push('-metadata:s:v:0',`title="[${argv.ftag.replace(/"/g,'\'')}]"`);
        ffmux.push('-metadata:s:a:0',`language=${audioDub}`);
        ffmux = ffmux.concat(ffmeta);
        ffmux.push(`"${muxFile}.${ffext}"`);
        try{ shlp.exec('ffmpeg',`"${ffmpegbinfile}"`,ffmux.join(' ')); }catch(e){}
        isMuxed = true;
    }
    else{
        console.log('\n[INFO] Done!\n');
        return;
    }
    // chack paths if same
    if(path.join(cfg.dir.trash) == path.join(cfg.dir.content)){
        argv.notrashfolder = true;
        // argv.nocleanup = true;
    }
    if(argv.nocleanup && !fs.existsSync(cfg.dir.trash)){
        argv.notrashfolder = true;
    }
    // cleanup
    if(argv.notrashfolder && argv.nocleanup){
        // don't move or delete temp files
    }
    else if(argv.nocleanup){
        let toTrashTS = path.join(cfg.dir.trash,`${fnOutput}`);
        if(isMuxed){
            fs.renameSync(`${muxFile}.ts`, toTrashTS + '.ts');
            if(fs.existsSync(`${muxFile}.json`) && !argv.jsonmuxdebug){
                fs.renameSync(`${muxFile}.json`, toTrashTS + '.json');
            }
        }
        if(addSubs){
            for(let t of sxList){
                let subsFile  = path.join(cfg.dir.content, t.file);
                let subsTrash = path.join(cfg.dir.trash, t.file);
                fs.renameSync(subsFile, subsTrash);
            }
        }
    }
    else if(isMuxed){
        fs.unlinkSync(`${muxFile}.ts`);
        if(fs.existsSync(`${muxFile}.json`) && !argv.jsonmuxdebug){
            fs.unlinkSync(`${muxFile}.json`);
        }
        if(addSubs){
            for(let t of sxList){
                let subsFile = path.join(cfg.dir.content, t.file);
                fs.unlinkSync(subsFile);
            }
        }
    }
    // move to subfolder
    if(argv.folder && isMuxed){
        const dubSuffix = audioDub != 'jpn' ? ` [${audioDub.toUpperCase().slice(0, -1)}DUB]` : '';
        const titleFolder = shlp.cleanupFilename(fnTitle + dubSuffix);
        const subFolder = path.join(cfg.dir.content, '/', titleFolder, '/');
        const vExt = '.' + ( !argv.mp4 ? 'mkv' : 'mp4' );
        if(!fs.existsSync(subFolder)){
            fs.mkdirSync(subFolder);
        }
        fs.renameSync(muxFile + vExt, path.join(subFolder, fnOutput + vExt));
    }
    // done
    console.log('\n[INFO] Done!\n');
}

function fnOutputGen(){
    const fnPrepOutput = argv.filename.toString()
        .replace('{rel_group}', argv.a)
        .replace('{title}', fnTitle)
        .replace('{ep_num}', fnEpNum)
        .replace('{suffix}', fnSuffix);
    return shlp.cleanupFilename(fnPrepOutput);
}

// get url
async function getData(durl, params){
    params = params || {};
    // options
    let options = {
        method: params.method ? params.method : 'GET',
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:76.0) Gecko/20100101 Firefox/76.0',
        },
    };
    // set binary
    if(params.binary == true){
        options.responseType = 'buffer';
    }
    // set headers
    if(params.headers){
        options.headers = params.headers;
    }
    // set additional headers
    if(options.method == 'POST'){
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    // set body
    if(params.body){
        options.body = params.body;
    }
    // proxy
    if(params.useProxy && argv.proxy && argv.curl){
        try{
            options.curlProxy =  buildProxy(argv.proxy);
            options.curlProxyAuth = argv['proxy-auth'];
        }
        catch(e){
            console.log(`[WARN] Not valid proxy URL${e.input?' ('+e.input+')':''}!`);
            console.log('[WARN] Skiping...\n');
            argv.proxy = false;
        }
    }
    // if auth
    let cookie = [];
    const loc = new URL(durl);
    if(loc.origin == domain || loc.origin == apidomain){
        for(let uCookie of usefulCookies.auth){
            if(checkCookieVal(session[uCookie])){
                cookie.push(uCookie);
            }
        }
        for(let uCookie of usefulCookies.sess){
            if(checkSessId(session[uCookie]) && !argv.nosess){
                cookie.push(uCookie);
            }
        }
        if(!params.skipCookies){
            cookie.push('c_locale');
            options.headers.Cookie = shlp.cookie.make({
                ...{ c_locale : { value: 'enUS' } },
                ...session,
            }, cookie);
        }
    }
    if(loc.origin == domain){
        options.minVersion = 'TLSv1.3';
        options.maxVersion = 'TLSv1.3';
        options.http2 = true;
    }
    // debug
    options.hooks = {
        beforeRequest: [
            (options) => {
                if(argv.debug){
                    console.log('[DEBUG] GOT OPTIONS:');
                    console.log(options);
                }
            }
        ]
    };
    if(argv.debug){ 
        options.curlDebug = true;
    }
    // do req
    try {
        let res;
        if(argv.curl && loc.origin == domain){
            const curlReq = require('./modules/module.curl-req');
            res = await curlReq(durl.toString(), options, path.join(__dirname, './config/'));
        }
        else{
            res = await got(durl.toString(), options);
        }
        if(!params.skipCookies && res.headers['set-cookie']){
            setNewCookie(res.headers['set-cookie']);
            for(let uCookie of usefulCookies.sess){
                if(session[uCookie] && argv.nosess){
                    argv.nosess = false;
                }
            }
        }
        return {
            ok: true,
            res,
        };
    }
    catch(error){
        if(error.response && error.response.statusCode && error.response.statusMessage){
            console.log(`[ERROR] ${error.name} ${error.response.statusCode}: ${error.response.statusMessage}`);
        }
        else{
            console.log(`[ERROR] ${error.name}: ${error.code || error.message}`);
        }
        if(error.response && !error.res){
            error.res = error.response;
            const docTitle = error.res.body.match(/<title>(.*)<\/title>/);
            if(error.res.body && docTitle){
                console.log('[ERROR]', docTitle[1]);
            }
        }
        return {
            ok: false,
            error,
        };
    }
}
function setNewCookie(setCookie, isAuth){
    let cookieUpdated = [];
    setCookie = shlp.cookie.parse(setCookie);
    for(let uCookie of usefulCookies.auth){
        if(isAuth || setCookie[uCookie]){
            session[uCookie] = setCookie[uCookie];
            cookieUpdated.push(uCookie);
        }
    }
    for(let uCookie of usefulCookies.sess){
        if(
            isAuth 
            || argv.nosess && setCookie[uCookie]
            || setCookie[uCookie] && !checkSessId(session[uCookie])
        ){
            const sessionExp = 60*60;
            session[uCookie]            = setCookie[uCookie];
            session[uCookie].expires    = new Date(Date.now() + sessionExp*1000);
            session[uCookie]['Max-Age'] = sessionExp.toString();
            cookieUpdated.push(uCookie);
        }
    }
    if(cookieUpdated.length > 0){
        session = yaml.stringify(session);
        if(argv.debug){
            console.log('[SAVE FILE]',`${sessCfgFile}.yml`);
        }
        fs.writeFileSync(`${sessCfgFile}.yml`, session);
        session = yaml.parse(session);
        console.log(`[INFO] Cookies were updated! (${cookieUpdated.join(', ')})\n`);
    }
}
function checkCookieVal(chcookie){
    return     chcookie
            && chcookie.toString()   == '[object Object]'
            && typeof chcookie.value == 'string'
        ?  true : false;
}
function checkSessId(session_id){
    return     session_id
            && session_id.toString()     == '[object Object]'
            && typeof session_id.expires == 'string'
            && Date.now() < new Date(session_id.expires).getTime()
            && typeof session_id.value   == 'string'
        ?  true : false;
}
function buildProxy(proxyBaseUrl, proxyAuth){
    if(!proxyBaseUrl.match(/^(https?|socks4|socks5):/)){
        proxyBaseUrl = 'http://' + proxyBaseUrl;
    }
    
    let proxyCfg = new URL(proxyBaseUrl);
    let proxyStr = `${proxyCfg.protocol}//`;
    
    if(typeof proxyCfg.hostname != 'string' || proxyCfg.hostname == ''){
        throw new Error('[ERROR] Hostname and port required for proxy!');
    }
    
    if(proxyAuth && typeof proxyAuth == 'string' && proxyAuth.match(':')){
        proxyCfg.username = proxyAuth.split(':')[0];
        proxyCfg.password = proxyAuth.split(':')[1];
        proxyStr += `${proxyCfg.username}:${proxyCfg.password}@`;
    }
    
    proxyStr += proxyCfg.hostname;
    
    if(!proxyCfg.port && proxyCfg.protocol == 'http:'){
        proxyStr += ':80';
    }
    else if(!proxyCfg.port && proxyCfg.protocol == 'https:'){
        proxyStr += ':443';
    }
    
    return proxyStr;
}
