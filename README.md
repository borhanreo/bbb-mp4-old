# bbb-mp4

This app converts a BigBlueButton recording into MP4 video and upload to S3.

We have implemented several different ways to convert MP4 videos:
1. Convert one file at a time by executing `node bbb-mp4 MEETING_ID`
2. Convert in bulk from recording directory by executing `./bbb-mp4-bulk-parallel.sh`
3. Convert in bulk from the given recording ids in a file by executing `./bbb-mp4-bulk-parallel-input-file.sh`
4. Convert automatically as soon as recording is published. Follow the instructions to [setup supervisor](https://github.com/manishkatyan/bbb-mp4#automate-mp4-conversion).

**How it works?**

When you execute `node bbb-mp4`, Chrome browser is opened in the background with the BigBlueButton playback URL in a Virtual Screen Buffer, the recording is played and the screen is recorded WEBM format. After compeltion of recording, FFMEG is used to convert to MP4 and AWS CLI is used to upload to S3.

## Install

1. Install XVFB
```sh
apt install xvfb
```

2. Install latest Google Chrome:

```sh
curl -sS -o - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get -y update
apt-get -y install google-chrome-stable
```

3. Install FFmpeg:
```sh
sudo add-apt-repository ppa:jonathonf/ffmpeg-4
sudo apt-get update
sudo apt-get install ffmpeg
```

4. Install latest version of node
```sh
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt-get install -y nodejs
```

5. Setup [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html). Be ready with your AWS Access Key ID, Secret Access Key, [Default region name](https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region), Default output format (json) and enter when asked upon executing `aws configure`.
```sh
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install
aws configure
```

6. Clone bbb-mp4, install NPM modules and execute what `./dependencies_check.sh` tells you to 
```sh
git clone https://github.com/manishkatyan/bbb-mp4.git
cd bbb-mp4
apt install npm
npm install --ignore-scripts
cp .env.example .env
./dependencies_check.sh
```

## Usage

Update .env file:
1) playBackURL is `https://<domain>/playback/presentation/2.0/playback.html?meetingId=xxxx` for default playback of BBB 2.2.x
2) By default Chrome downloads meeting recording in `Downloads` direcotry of the user or `/tmp`, when executed in the background. Hence, we explicetly set `copyFromPath` i.e. download location of the recording so that bbb-mp4 can correctly read the downloaded file and proceed with conversion into MP4   
3) `copyToPath` is where MP4 files are kept. By default we store it at `bbb-mp4/mp4`. You can change it to `/var/www/bigbluebutton-default/recording/` to make your MP4 recordings accessible on your BigBlueButton server with the url as `https://<domain>/recording/MEETING_ID.mp4`
4) `S3BucketName` is the bucket name of S3. Default file permission is `--acl public-read`. You can change permission in `bbb-mp4.js > uploadToS3`
5) `recordingDir` is where recordings of the meetings are kept by BigBlueButton. If you run this project on your BigBlueButton server, then this value would be `/var/bigbluebutton/published/presentation/`. If you run this project on Scalelite server to convert all recordings on Scalelite into MP4, this value would be `/mnt/scalelite-recordings/var/bigbluebutton/published/resentation`.

## Record Meetings in MP4 and upload to S3

```sh
node bbb-mp4 MEETING_ID
```

### Options

1) `MEETING_ID` is the internal meeting id of the recording that you want to convert into MP4. 
2) The MP4 file of the given meeting id is kept in `mp4` directory
3) The command above will record meeting in WEBM format, convert to MP4 and upload to S3. 

## Convert MP4 in Bulk

```sh
apt-get install parallel
```

We use [GNU Parallel](https://www.gnu.org/software/parallel/) to convert multiple MP4 recordings simultaneously. So Install GNU Parallel.  

We will run 2 jobs simultaneously using Parallel that will pass recording-id to node bbb-mp4 to convert into MP4. Once any of the two jobs are completed, Parallel will pass the next recording-id to `node bbb-mp4` to convert.

**Pro Tips** 
- Running 6 or more jobs in parallel may result errors such as unable to stop Xvfb. To be on a safer side, I prefer running 2-3 jobs in parallel.
- When you execute `ps aux | grep parallel` or `ps aux | grep node` and notice TTY column showing `?`, most likely that process has hanged. Better to just kill that process with 'kill -9 PROCESS-ID` and start over again.   

You have the following two methods:

### Method 1: Convert MP4 from recordings in /published/presentation/ directory

```sh
./bbb-mp4-bulk-parallel.sh
```

This method is useful when you are running bbb-mp4 on BigBlueButton or Scalelite server. You can set from and to date to convert into MP4 recordings from the given date range.

Open file bbb-mp4-bulk-parallel.sh and verify from date, to date and recordings directory, which will be different for BigBlueButton and Scalelite. 

Once you are ready, execute `bbb-mp4-bulk-parallel.sh`.
 

### Method 2: Convert MP4 from recording Ids listed in a file 

```sh
find /var/bigbluebutton/published/presentation -maxdepth 1 -newerct "22 Sep 2020" ! -newerct "23 Sep 2020" -printf "%f\n" > bbb-unprocessed-recordings.txt

./bbb-mp4-bulk-parallel-input-file.sh
```

This method is useful when you want to convert a list of recordings. For example, some recordings failed to get converted in the method 1 above and you want to convert only those recordings. Another example, you want to run MP4 conversion process on a different server - not on BigBlueButton or Scalelite server. 

You need to prepare a list of recordings that you want to convert into MP4. For example you could use find command to create list of meetings on 22 Sep that is to be converted into MP4 as shown above. 

Execute bbb-mp4-bulk-parallel-input-file.sh to start MP4 conversion with 2 jobs in parallel.

## Upload to AWS S3

```sh
aws s3 sync mp4/ s3://S3_BUCKET_NAME  --acl public-read
```

In stead of uploading files one at a time, use aws s3 sync to upload MP4 files which have not been uploaded already to your AWS S3 bucket. 

### Verify MP4 videos on AWS S3

```sh
./s3-verify-recordings.sh
```

At times, you may not be sure which recordings are not converted to MP4 yet. 

Put all the recordings that you want to verify into `bbb-unprocessed-recordings.txt` and execute `s3-verify-recordings.sh`. This script will check whether the recording ids mentioned in `bbb-unprocessed-recordings.txt` are uploaded to AWS S3. It will update `bbb-unprocessed-recordings.txt` with the recordings which are not already present on AWS S3.  

Now you can follow Method 2 above to convert recordings mentioned in the updated `bbb-unprocessed-recordings.txt` file. 

## Automate MP4 Conversion

```sh
apt-get install supervisor
apt-get install inotify-tools
service supervisor restart
cp watch-recording-bbb-mp4.conf /etc/supervisor/conf.d/watch-recording-bbb-mp4.conf
supervisorctl reread
supervisorctl update
tail -f /root/bbb-mp4/log/watch-recording-bbb-mp4.out.log
```

1) Install [supervisor](https://www.digitalocean.com/community/tutorials/how-to-install-and-manage-supervisor-on-ubuntu-and-debian-vps)
2) Copy `watch-recording-bbb-mp4.conf` to `/etc/supervisor/conf.d`
3) Inform Supervisor of our new program through the supervisorctl command. At this point our program should now be running to watch for any new meetings and we can check this is the case by looking at the output log file: /root/bbb-mp4/log/watch-recording-bbb-mp4.out.log
4) You can test whether watch is working using the test script - `watch-recording-bbb-mp4-test.sh` - update `DIRECTORY_TO_TEST` and `TEST_MEETING_ID` as appropriate


## More on BigBlueButton

Check-out the following apps to further extend features of BBB.

### [bbb-twilio](https://github.com/manishkatyan/bbb-twilio)

Integrate Twilio into BigBlueButton so that users can join a meeting with a dial-in number. You can get local numbers for almost all the countries. 

### [bbb-optimize](https://github.com/manishkatyan/bbb-customize)

Better audio quality, increase recording processing speed, dynamic video profile, pagination, fix 1007/1020 errors and use apply-config.sh to manage your customizations are some key techniques for you to optimize and smoothly run your BigBlueButton servers.

### [bbb-streaming](https://github.com/manishkatyan/bbb-streaming)

Livestream your BigBlueButton classes on Youtube or Facebook to thousands of your users.

### [100 Most Googled Questions on BigBlueButton](https://higheredlab.com/bigbluebutton-guide/)

Everything you need to know about BigBlueButton including pricing, comparison with Zoom, Moodle integrations, scaling, and dozens of troubleshooting.

#### Inspired by

bbb-mp4 app builds on the ideas from several other projects, especially:

[puppetcam](https://github.com/muralikg/puppetcam)

[Canvas-Streaming-Example](https://github.com/fbsamples/Canvas-Streaming-Example)

[bbb-recorder](https://github.com/jibon57/bbb-recorder)


CRONTAB run run.sh