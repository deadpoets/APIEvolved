var exec   = require('child_process').exec;
var fs     = require('fs');
var ini    = require('ini');
var Logger = require('./Log');
var Config = require('./Config');
var Steam  = require('./Steam');
var RCON   = require('./RCON');
var Query  = require('./Query');
var ps     = require('ps-node');
var portscanner = require('portscanner');

// Get ARK: Survival Evolved Server Settings
exports.GetConfig = function(callback) {
    Config.Load(function(config) {
        var gconf = ini.parse(fs.readFileSync(config.Server.Win64 + "\\..\\..\\Saved\\Config\\WindowsServer\\GameUserSettings.ini", 'utf-8'));
        callback(gconf);
    });
};


// Initializing function
exports.Init = function() {
    var self = this;

    Config.Load(function(config) {
        if(config.Server.AutoStart) {
            // Server should start automatically.
            self.Start(function(game) {});
        }
    });

};


// Starts ARK: Survival Evolved Server
exports.Start = function(callback) {
    var self = this;
    // Make sure it's not running
    this.IsRunning(function(res) {
        if(!res.running) {

            Config.Load(function(config) {
                self.CheckAutoUpdate(function(check) {
                    if(check.update) {
                        global.state.WaitForUpdate = true;
                        // Update available
                        Logger.log('info', '[Update] Available, updating...');
                        Steam.Update(function() {
                            // Updated
                            var game = exec(config.Server.Win64 + "\\ShooterGameServer.exe " + config.Server.Params, { cwd: config.Server.Win64 });
                            Logger.log('info', "[Server] Started");
                            callback({running: true, pid: game.pid});
                        });
                    } else {
                        // No updates, start server.
                        var game = exec(config.Server.Win64 + "\\ShooterGameServer.exe " + config.Server.Params, { cwd: config.Server.Win64 });
                        Logger.log('info', "[Server] Started");
                        callback({running: true, pid: game.pid});
                    }
                }, true);
            });
        } else {
            // Server is running
            Logger.log('info', "[Server] Running");
            callback(res);
        }
    });
};

exports.CheckAutoUpdate = function(callback, force) {
    Logger.log('debug', "[Update] Checking for updates.");

    var response = {
        update: false,
        message: null
    };

    Config.Load(function(config) {
        if (config.Server.AutoUpdate.Enabled) {
            // Automatic Updates Enabled

            // Check if there's any available updates
            Steam.UpdateAvailable(function(update) {

                if(update.status) {
                    // There is an update available, check if it matches our policy settings
                    if(force) {
                        // This will only happen upon restarting server
                        response.update = true;
                        callback(response);
                    } else {
                        if (config.Server.AutoUpdate.OnlyMajor) {
                            // We only want to update on major version
                            if (update.type == "major") {

                                response.update = true;
                                callback(response);

                            } else {

                                // This is not a major update.
                                callback(response);

                            }
                        } else {
                            // We're want both minor and major updates
                            response.update = true;
                            callback(response);
                        }
                    }

                } else {

                    // No update available
                    callback(response);

                }

            });

        } else {

            // Auto Updates Disabled
            callback(response);

        }
    });
};

// Stops ARK: Survival Evolved Server gracefully.
exports.Stop = function(callback) {
    var self = this;

    // Stop any other scheduled shutdowns
    self.CancelNiceStop(function() {});

    // Check if server is running
    self.IsRunning(function(res) {
        if(!res.running) {
            // Not running
            callback(true);

        } else if(res.running && !res.initialized) {
            // Server is running but not initialized yet.
            self.Kill(function() {
                callback(true);
            });
        } else if(res.running && res.initialized) {
            // Server is running and initialized, save world, then kill.
            RCON.Command("saveworld", function(res) {
                Logger.log('info', '[Server] ' + res.message);
                setTimeout(function() {
                    self.Kill(function()  {
                        setTimeout(function() {
                            callback(true);
                        }, 1500);
                    }) ;
                }, 1500);
            });
        }
    });
};

// Kills ARK: Survival Evolved Server process.
exports.Kill = function (callback) {
    Config.Load(function(config) {
        // Find processes that matches our running server.
        ps.lookup({command: "ShooterGameServer.exe"}, function (err, list) {
            list.forEach(function (p) {
                if (p.command == config.Server.Win64 + "\\ShooterGameServer.exe") {
                    // Kill it with fire
                    try {
                        process.kill(p.pid, "SIGTERM");
                    } catch(e) {
                        // Prevent kill ESRCH
                    }
                }
            });
            callback();
        });
    });
};

// Checks if ARK: Survival Evolved Server is running.
exports.IsRunning = function(callback) {
    var self = this;
    var response = {
        running: false,
        process: null,
        initialized: false
    };

    // Load API Configuration
    Config.Load(function(config) {
        // Check if server is running
        ps.lookup({command: "ShooterGameServer.exe"}, function(err, list) {
            list.forEach(function(p) {
                if(p.command == config.Server.Win64 + "\\ShooterGameServer.exe") {
                    // Process matches configured server instance.
                    response.running = true;
                    response.process = p;
                }
            });
            if(!response.running) {
                // Not running
                callback(response);
            } else {
                // Process is running
                response.running = true;

                self.GetConfig(function(gc) {
                    portscanner.checkPortStatus(parseInt(gc.ServerSettings.RCONPort), '127.0.0.1', function(error, status) {
                        // Status is 'open' if currently in use or 'closed' if available
                        response.initialized = (status == 'open');
                        global.state.WaitForUpdate = (status != 'open');
                        Query.Run(function(data) {
                            // Make sure we actually query at this point.

                        });
                        setTimeout(function() {
                            callback(response);
                        }, 1000);

                    })
                });
            }

        });
    });
};

// Schedules a graceful Stop of the ARK: Survival Evolved Server.
exports.StopNice = function(message, callback) {
    var self = this;
    self.CancelNiceStop(function() {

        Logger.log('info', "[Server] Shutdown Scheduled: " + message);

        self.IsRunning(function(res) {
            if (res.running && res.initialized) {


                RCON.Command("broadcast Server shutdown in 15 minutes, " + message, function () {
                    Logger.log('info', "[Server] Shutdown in 15 minutes");
                });

                var timer = setTimeout(function () {
                    RCON.Command("broadcast Server shutdown in 10 minutes, " + message, function () {
                        Logger.log('info', "[Server] Shutdown in 10 minutes");
                    });
                }, 300000);
                global.timers.niceStop.push(timer);

                timer = setTimeout(function () {
                    RCON.Command("broadcast Server shutdown in 5 minutes, " + message, function () {
                        Logger.log('info', "[Server] Shutdown in 5 minutes");
                    });
                }, 600000);
                global.timers.niceStop.push(timer);

                timer = setTimeout(function () {
                    RCON.Command("broadcast Server shutdown in 3 minutes, " + message, function () {
                        Logger.log('info', "[Server] Shutdown in 3 minutes");
                    });
                }, 720000);
                global.timers.niceStop.push(timer);

                timer = setTimeout(function () {
                    RCON.Command("broadcast Server shutdown in 1 minute, " + message, function () {
                        Logger.log('info', "[Server] Shutdown in 1 minute");
                    });
                }, 840000);
                global.timers.niceStop.push(timer);

                timer = setTimeout(function () {
                    RCON.Command("broadcast Server is shutting down, " + message, function () {
                        Logger.log('info', "[Server] Shutting down");
                    });
                }, 900000);
                global.timers.niceStop.push(timer);

                timer = setTimeout(function () {
                    self.Stop(function() {
                        callback();
                    });
                }, 901000);
                global.timers.niceStop.push(timer);

            } else {
                // Server is not running / initialized
                self.Stop(function () {
                    callback();
                });
            }
        });
    });
};

exports.CancelNiceStop = function(callback) {
    if(global.timers.niceStop.length > 0) {
        for (var t in global.timers.niceStop) {
            clearTimeout(global.timers.niceStop);
        }
        global.timers.niceStop = [];
        Logger.log('info', "[Sheduler] Scheduled shutdown cancelled.");
        callback();
    } else {
        callback();
    }
};