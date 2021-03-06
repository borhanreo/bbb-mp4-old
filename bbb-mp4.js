const puppeteer = require('puppeteer');
const Xvfb      = require('xvfb');
const fs = require('fs');
const os = require('os');
const homedir = os.homedir();
const platform = os.platform();
const { copyToPath, copyFromPath, playBackURL, S3BucketName, uploadMP4ToS3, recordingDir } = require('./env');
const spawn = require('child_process').spawn;
//Required to find the latest file (downloaded webm) in a directory
const glob = require('glob');
//Required for S3 upload
const { exec } = require('child_process');
const cron = require("node-cron"); 
var currentId=0;
var totalId = 0;
var CurrentIdMap = new Map;
var completedIdMap = new Map;
var completedIdStatusMap = new Map;
var mysql = require('mysql');
var totalRecMap = new Map;
// var con = mysql.createConnection({
//     host: "localhost",
//     user: "root",
//     password: "admin",
//     database: "record"
//   });
var con  = mysql.createPool({
    host            : 'localhost',
    user            : 'root',
    password        : 'admin',
    database        : 'record'
});
var xvfb        = new Xvfb({
    silent: true,
    timeout: 5000,	
    xvfb_args: ["-screen", "0", "1280x800x24", "-ac", "-nolisten", "tcp", "-dpi", "96", "+extension", "RANDR"]
});
var width       = 1280;
var height      = 720;
var options     = {
  headless: false,
  args: [
    '--enable-usermedia-screen-capturing',
    '--allow-http-screen-capture',
    '--auto-select-desktop-capture-source=bbbrecorder',
    '--load-extension=' + __dirname,
    '--disable-extensions-except=' + __dirname,
    '--disable-infobars',
    '--no-sandbox',
    '--shm-size=1gb',
    '--disable-dev-shm-usage',
    '--start-fullscreen',
    '--app=https://www.google.com/',
    `--window-size=${width},${height}`,
  ],
}

if(platform == "linux"){
    options.executablePath = "/usr/bin/google-chrome";
}else if(platform == "darwin"){
    options.executablePath = "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome";
}

async function main(id) {
    let browser, page;

    try{
        if(platform == "linux"){
            xvfb.startSync()
        }


	//var meetingId = process.argv[2];
	var meetingId = id;
	var url = playBackURL + meetingId;	   
	
	console.log("Fetching: " + url);

	//Chrome downloads video in webm format. So first download in webm format and then convert into MP4 using ffmpeg
    var exportname = meetingId + '.webm';

    var duration = 0;

    var convert = true;

    browser = await puppeteer.launch(options);
    const pages = await browser.pages();

    page = pages[0]

    page.on('console', msg => {
        var m = msg.text();
        //console.log('PAGE LOG:', m) // uncomment if you need
    });

    await page._client.send('Emulation.clearDeviceMetricsOverride')

    //Set the download location of webm recordings. This is useful when you execute this script as background to record multiple recordings using parallel
	await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: copyFromPath + meetingId})

    // Catch URL unreachable error
    await page.goto(url, {waitUntil: 'networkidle2'}).catch(e => {
        console.error('Recording URL unreachable!');
        process.exit(2);
    })
    await page.setBypassCSP(true)

    // Check if recording exists (search "Recording not found" message)
    var loadMsg = await page.evaluate(() => {
        return document.getElementById("load-msg").textContent;
    });
    if(loadMsg == "Recording not found"){
        console.warn("Recording not found!");
        //process.exit(1);
        updateValueWithout();
    }

    // Get recording duration
    var recDuration = await page.evaluate(() => {
        return document.getElementById("video").duration;
    });
    // If duration was set to 0 or is greater than recDuration, use recDuration value
    if(duration == 0 || duration > recDuration){
        duration = recDuration;
    }

    await page.waitForSelector('button[class=acorn-play-button]');
    await page.$eval('#navbar', element => element.style.display = "none");
    await page.$eval('#copyright', element => element.style.display = "none");
    await page.$eval('.acorn-controls', element => element.style.opacity = "0");
    await page.click('button[class=acorn-play-button]', {waitUntil: 'domcontentloaded'});

    await page.evaluate((x) => {
        console.log("REC_START");
        window.postMessage({type: 'REC_START'}, '*')
    })

    // Perform any actions that have to be captured in the exported video
    await page.waitFor((duration * 1000))

    await page.evaluate(filename=>{
        window.postMessage({type: 'SET_EXPORT_PATH', filename: filename}, '*')
        window.postMessage({type: 'REC_STOP'}, '*')
    }, exportname)


    // Wait for download of webm to complete
    await page.waitForSelector('html.downloadComplete', {timeout: 0})

    convertAndCopy(exportname)

    }catch(err) {
        console.log(err)
        
    } finally {
        page.close && await page.close()
        browser.close && await browser.close()

        xvfb.stopSync()
    }
}
function updateValue(){        
    databasesPortionInsert(totalRecMap.get(currentId), currentId);
}
function updateValueWithout(){
      CurrentIdMap.set('currentId', currentId);
      completedIdStatusMap.set('currentIdStatus', true);
      currentId++;
}
function deleteMp4(id){
    try {
        fs.unlinkSync(copyToPath+totalRecMap.get(currentId)+'.mp4');
        console.log('mp4 file deleted '+copyToPath+totalRecMap.get(currentId)+'.mp4');
        //file removed
      } catch(err) {
        console.error(err)
      }
      
      CurrentIdMap.set('currentId', currentId);
      completedIdStatusMap.set('currentIdStatus', true);
      currentId++;
}
function main1(){
    //https://calculator.aws/#/estimate?id=d47f237018ac7b34495775862bb12663b92002d1
    // for(i=0;i<=4;i++){
    //     main('a370c0cbed7805985f854defeba03b4001cbc252-1614576527328');
    // }
    var i=0;
    var runningIdCounter=0;
    fs.readdir(recordingDir, (err, files) => {
        files.forEach(file => {
            if(file.length==54){
                //console.log('recording: '+totalId, file); 
                totalRecMap.set(i,file);               
                totalId++;
                i++;
            }          
        });
        console.log('total recording: ', totalId+" of "+currentId);
        //console.log('total ',totalRecMap.size+' '+ totalRecMap.get(1));
        var interval = setInterval(function(){                         
            if(CurrentIdMap.get('currentId')==totalId-1){
                clearInterval(interval); 
                console.log('completed '); 
                process.exit();          
            }else{   
                //console.log(completedIdStatusMap['currentIdStatus']+'  '+completedIdMap)             
                if(completedIdStatusMap.get('currentIdStatus')==true){
                    console.log('######### new start..'+totalRecMap.get(currentId)); 
                    runningIdCounter=1; 
                    completedIdStatusMap.set('currentIdStatus', false);
                    //main(totalRecMap.get(currentId+1));       
                    databasesPortionSelect(totalRecMap.get(currentId),currentId);             
                }else{
                    
                    if(runningIdCounter==0){
                        databasesPortionSelect(totalRecMap.get(currentId),currentId);
                        //main(totalRecMap.get(currentId));
                        console.log('######## Start ..'+totalRecMap.get(currentId));                        
                    }
                                                            
                    runningIdCounter++;
                }
            }                                        
        }, 60000);
      });
    
}
function databasesPortionSelect(rec_id, activeId){
    con.getConnection(function (err, connection) {
        con.query("SELECT rec_id FROM tbl_record WHERE rec_id = '"+rec_id+"'", function (err, result) {
            if (err) throw err;
              console.log(result);
              if(result.length>0){
                  console.log('row has ');
                  updateValueWithout();
              }else{
                  console.log('row no');
                  main(totalRecMap.get(activeId));
              }
          });
    });
}
function databasesPortionInsert(rec_id,last_id){
    con.getConnection(function (err, connection) {
        console.log("Connected!");
        var sql = "INSERT INTO tbl_record (rec_id) VALUES ('"+rec_id+"')";
        con.query(sql, function (err, result) {
          if (err) throw err;
          console.log("1 record inserted");
          deleteMp4(last_id);
        });
      });
}
function databasesPortionNew(){
    con.getConnection(function (err, connection) {
        console.log("Connected!");
        var sql = "CREATE TABLE tbl_record(rec_id VARCHAR(255))";
        con.query(sql, function (err, result) {
              if (err){ 
                console.log("failed to create "+err);
                throw err;
              }else{ 
                  console.log("Table new created");
              }    
          });            
      });
}
// cron.schedule("*/59 * * * * *", function() { 
//     console.log("running a task every 59 second"); 
//     main1();
// }); 
main1()
//run
//databasesPortionNew();
function convertAndCopy(filename){

    console.log("Starting conversion ...");

    var onlyfileName = filename.split(".webm");
    var copyFromPathForRecording = copyFromPath + onlyfileName[0];
    var mp4File = onlyfileName[0] + ".mp4";
    var copyTo = copyToPath + mp4File;    

    var newestFile = glob.sync(copyFromPathForRecording + '/*webm').map(name => ({name, ctime: fs.statSync(name).ctime})).sort((a, b) => b.ctime - a.ctime)[0].name;

    var copyFrom = newestFile;	

    if(!fs.existsSync(copyToPath)){
        fs.mkdirSync(copyToPath);
    }

    console.log(copyTo);
    console.log(copyFrom);

    const ls = spawn('ffmpeg',
        [   '-y',
            '-i "' + copyFrom + '"',
            '-c:v copy',
            '"' + copyTo + '"'
        ],
        {
            shell: true
        }

    );

    /*	
    ls.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    ls.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });
    */

    ls.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        if(code == 0) {
            console.log("Convertion done to here: " + copyTo)
            fs.rmdirSync(copyFromPathForRecording, { recursive: true });		
            console.log('successfully deleted ' + copyFromPathForRecording);

	    if(uploadMP4ToS3 == "true") {
                uploadToS3(copyTo);
	    }
        }

    });

}

function uploadToS3(fileName) {
  console.log("Starting S3 upload ...");
  var cmd = 'aws s3 cp ' + fileName + ' s3://' + S3BucketName + ' --acl public-read';
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      //some err occurred
      console.error(err)
    } else {
      // the *entire* stdout and stderr (buffered)
      console.log(`stdout: ${stdout}`);
      console.log(`stderr: ${stderr}`);
      updateValue();
    }
  });
}
