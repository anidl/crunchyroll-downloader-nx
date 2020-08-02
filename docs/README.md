# Crunchyroll Downloader NX

Crunchyroll Downloader NX is capable of downloading videos from the *Crunchyroll* streaming service.

Fork of @seiya-dev's Crunchyroll Downloader NX

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

## Prerequisites

* NodeJS >= 12.2.0 (https://nodejs.org/)
* NPM >= 6.9.0 (https://www.npmjs.org/)
* ffmpeg >= 4.0.0 (https://www.videohelp.com/software/ffmpeg)
* MKVToolNix >= 20.0.0 (https://www.videohelp.com/software/MKVToolNix)

### Paths Configuration

By default this application uses the following paths to programs (main executables):
* `./bin/mkvmerge`
* `./bin/ffmpeg`

To change these paths you need to edit `yml` file in `./config/` directory.

### Node Modules

After installing NodeJS with NPM go to directory with `package.json` file and type: `npm i`.
* [check dependencies](https://david-dm.org/anidl/crunchyroll-downloader-nx)

## CLI Options

### Authentication

* `--auth` enter auth mode
* `--user <user>` skip the username dialog in auth mode (optional)
* `--pass <pass>` skip the password dialog in auth mode (optional)

### Fonts

* `--dlfonts` download all required fonts for mkv muxing to fonts folder

### Get Show ID

* `--search <s>` or `-f <s>` sets the show title for search
* `--search2 <s>` or `-g <s>` sets the show title for search (multi-language, experimental)

### Download Video/Subtitles

* `-s <i> -e <s>` sets the show id and episode ids (comma-separated, hyphen-sequence)
* `-q <s>` sets the video quality [240p ... 1080p, max] (optional)
* `--dub <s>` sets audio language by language code (sometimes not detect correctly)
* `-x` select server
* `--tsparts` Download ts parts in batch [1...10] (default: 10)
* `--dlsubs` download subtitles by language tag
* * supported language tags: "enUS", "esLA", "esES", "frFR", "ptBR", "ptPT", "arME", "itIT", "deDE", "ruRU", "trTR"
* `--oldstreams` use old api for fetching stream
* `--oldsubs` use old api for fetching subtitles
* `--skipdl`/`--novids` skip downloading video (for downloading subtitles only)
* `--skipmux` skip muxing video and subtitles

### Proxy

* `--proxy <s>` http(s)/socks proxy WHATWG url (ex. https://myproxyhost:1080)
* `--proxy-auth <s>` colon-separated username and password for proxy
* `--ssp` don't use proxy for stream and subtitles downloading

### Muxing

`[note] this application mux into mkv by default`
* `--mp4` mux into mp4
* `--mks` add subtitles to mkv/mp4 (if available)

### Filenaming (optional)

* `--filename <s>` filename template
* `-a <s>` release group
* `-t <s>` show title override
* `--ep <s>` episode number override (ignored in batch mode)
* `--el <i>` episode number length [1...4]
* `--suffix <s>` filename suffix override (first "SIZEp" will be replaced with actual video size, "SIZEp" by default)

### Utility

* `--ftag` custom title tag in muxed file info (override `-a` option)
* `--nocleanup` move unnecessary files to trash folder after completion instead of deleting
* `-h`, `--help` show all options

## Filename Template

* Default: `[{rel_group}] {title} - {ep_num} [{suffix}]`
* `{rel_group}` replace string from `-a` option
* `{title}` replace string by title or from `-t` option
* `{ep_num}` replace string by episode number
* `{suffix}` replace string from `--suffix` option

## CLI Examples

* `node crunchy --search "Naruto"` search "Naruto" in title
* `node crunchy -s 124389 -e 1,2,3` download episodes 1-3 from show with id 124389
* `node crunchy -s 124389 -e 1-3,2-7,s1-2` download episodes 1-7 and "S"-episodes 1-2 from show with id 124389
* `node crunchy -s 124389 -e m132223` download media_id 132223 from show with id 124389
