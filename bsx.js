const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const WebSocket = require('ws');
const { DateTime } = require('luxon');

class Bsx {
    constructor() {
        this.headers = {
            "accept": "application/json, text/plain, */*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "origin": "https://racer-bsx-dapp.vercel.app",
            "referer": "https://racer-bsx-dapp.vercel.app/",
            "sec-ch-ua": '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129", "Microsoft Edge WebView2";v="129"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0"
        };
        this.ws = null;
        this.isRefillRequested = false;
        this.refillTimeout = null;
        this.predictionInterval = null;
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [*] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [!] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [*] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [*] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục vòng lặp`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    connectWebSocket(authorization) {
        const wsUrl = `wss://zracer.pekor-twendee.io.vn/ws?init_data=${authorization}`;
    
        this.ws = new WebSocket(wsUrl, {
            headers: {
                ...this.headers,
                "authorization": `Bearer ${authorization}`
            }
        });
    
        this.ws.on('open', () => {
            this.log('Bắt đầu dự đoán', 'success');
            this.startPredictionInterval();
        });
    
        this.ws.on('message', async (data) => {
            const message = JSON.parse(data);
    
            if (message.gas !== undefined) {
                this.log(`Gas Còn: ${message.gas}`, 'info');
            }
    
            if (message.result === 'won') {
                this.log(`Win (${message.winningStreak}) | Points ${message.points} | Gas còn ${message.gas}`, 'custom');
            } else if (message.result === 'lost') {
                this.log(`Lost | Gas còn ${message.gas}`, 'custom');
            }
            
            if (message.gas === 0) {
                this.log('Gas còn 0, nạp gas...', 'warning');
                this.ws.send(JSON.stringify({ event: "refill" }));
                
                const refillResult = await new Promise(resolve => {
                    this.ws.once('message', (data) => {
                        const refillMessage = JSON.parse(data);
                        if (refillMessage.result === 'refilled') {
                            resolve({ success: true, gas: refillMessage.gas });
                        } else if (refillMessage.result === 'time reached') {
                            resolve({ success: false, timeReached: true });
                        } else {
                            resolve({ success: false });
                        }
                    });
                });
                
                if (refillResult.success) {
                    this.log(`Nạp gas thành công | New gas: ${refillResult.gas}`, 'success');
                } else if (refillResult.timeReached) {
                    this.log('Không thể nạp gas, ngắt kết nối...', 'warning');
                    this.stopPredictionInterval();
                    this.ws.close();
                } else {
                    this.log('Không thể nạp lại gas', 'error');
                    this.stopPredictionInterval();
                    this.ws.close();
                }
            }
        });
    
        this.ws.on('error', (error) => {
            this.log(`Lỗi kết nối: ${error.message}`, 'error');
        });
    
        this.ws.on('close', () => {
            this.log('Ngắt kết nối', 'warning');
            this.stopPredictionInterval();
        });
    }

    startPredictionInterval() {
        this.predictionInterval = setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                const option = Math.random() < 0.5 ? 'moon' : 'doom';
                const winOrMiss = Math.random() < 0.8 ? "win" : "miss";
                const prediction = { event: winOrMiss, option };
                
                this.log(`Dự đoán: ${option}`, 'info');
                this.ws.send(JSON.stringify(prediction));
            }
        }, 5000);
    }

    stopPredictionInterval() {
        if (this.predictionInterval) {
            clearInterval(this.predictionInterval);
            this.predictionInterval = null;
        }
    }


    async callAPI(authorization, endpoint = "users", method = "POST", data = {"refBy":"LtcZAUnn"}) {
        const url = `https://zracer.pekor-twendee.io.vn/${endpoint}`;
        const headers = { ...this.headers, "authorization": `Bearer ${authorization}` };
        try {
            const response = await axios({
                method: method,
                url: url,
                headers: headers,
                data: data
            });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: `HTTP error! status: ${response.status}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        while (true) {
            for (let i = 0; i < data.length; i++) {
                const authorization = data[i];
                let result = await this.callAPI(authorization);
                if (result.success) {
                    console.log(`========== Tài khoản ${i + 1} | ${result.data.username} ==========`);
                    this.log(`Lấy thông tin tài khoản thành công!`, 'success');
                    this.log(`Points: ${result.data.availablePoints}`, 'custom');

                    if (result.data.isBsxConnected && !result.data.farmingAvailable) {
                        this.log('Kích hoạt farming...', 'info');
                        const activateResult = await this.callAPI(authorization, "users/farming-feature/activating", "POST", {});
                        if (activateResult.success) {
                            this.log('Kích hoạt farming thành công!', 'success');
                            result = await this.callAPI(authorization);
                        } else {
                            this.log(`Lỗi kích hoạt farming: ${activateResult.error}`, 'error');
                        }
                    }

                    if (result.data.farmingAvailable) {
                        const farmingStartTime = DateTime.fromISO(result.data.latestFarmingTime);
                        const farmingEndTime = farmingStartTime.plus({ hours: 8 });
                        const now = DateTime.now();
                        
                        if (now > farmingEndTime) {
                            this.log('Thời gian farm đã kết thúc. Farming...', 'info');
                            const farmingResult = await this.callAPI(authorization, "tasks/farming", "POST", {});
                            if (farmingResult.success) {
                                this.log('Farming thành công!', 'success');
                                result = await this.callAPI(authorization);
                                const newFarmingStartTime = DateTime.fromISO(result.data.latestFarmingTime);
                                const newFarmingEndTime = newFarmingStartTime.plus({ hours: 8 });
                                const newRemainingTime = newFarmingEndTime.diff(now).toFormat("hh:mm:ss");
                                this.log(`Thời gian hoàn thành farm mới: ${newRemainingTime}`, 'custom');
                            } else {
                                this.log(`Lỗi farming: ${farmingResult.error}`, 'error');
                            }
                        } else {
                            const remainingTime = farmingEndTime.diff(now).toFormat("hh:mm:ss");
                            this.log(`Thời gian hoàn thành farm: ${remainingTime}`, 'custom');
                        }
                    }

                    this.connectWebSocket(authorization);
                    await new Promise(resolve => {
                        this.ws.on('close', resolve);
                    });

                } else {
                    this.log(`Lỗi đọc thông tin tài khoản: ${result.error}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.countdown(10 * 60);
        }
    }
}

const client = new Bsx();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});