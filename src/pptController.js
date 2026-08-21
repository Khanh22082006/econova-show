const { spawn } = require('child_process');

let psProcess = null;
let currentResolve = null;
let outBuffer = "";
let isReady = false;

const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class PptManager {
    private static dynamic _ppt = null;
    private static object consoleLock = new object();
    private static Thread watcherThread = null;
    private static int lastKnownSlideIndex = -1;
    private static bool isExecutingCommand = false;

    public static void StartWatcher() {
        if (watcherThread != null) return;
        watcherThread = new Thread(() => {
            bool isWarmedUp = false;
            while (true) {
                if (!isExecutingCommand) {
                    try {
                        dynamic ppt = GetPpt();
                        if (ppt != null) {
                            try {
                                dynamic view = null;
                                try {
                                    view = ppt.SlideShowWindows[1].View;
                                } catch {
                                    view = ppt.ActiveWindow.View;
                                }
                                dynamic slide = view.Slide;
                                
                                // WARM UP in background as soon as SlideShow is available
                                if (!isWarmedUp) {
                                    int count = ppt.ActivePresentation.Slides.Count;
                                    string notes = "";
                                    try { notes = slide.NotesPage.Shapes.Placeholders[2].TextFrame.TextRange.Text; } catch {}
                                    isWarmedUp = true;
                                }

                                int currentIndex = slide.SlideIndex;
                                if (currentIndex != lastKnownSlideIndex) {
                                    lastKnownSlideIndex = currentIndex;
                                    string currentStatus = GetStatus();
                                    if (currentStatus.StartsWith("{")) {
                                        lock (consoleLock) {
                                            Console.WriteLine("ASYNC_STATUS|" + currentStatus);
                                            Console.WriteLine("END_OF_COMMAND");
                                        }
                                    }
                                }
                            } catch {}
                        }
                    } catch {}
                }
                Thread.Sleep(200);
            }
        });
        watcherThread.IsBackground = true;
        watcherThread.Start();
    }

    public static void Init() {
        GetPpt();
    }

    private static dynamic GetPpt() {
        if (_ppt != null) {
            try {
                string name = _ppt.Name; 
                return _ppt;
            } catch {
                _ppt = null; 
            }
        }
        _ppt = Marshal.GetActiveObject("PowerPoint.Application");
        return _ppt;
    }

    public static string NextSlide() {
        return ExecuteSlideAction("next", 0);
    }
    public static string PrevSlide() {
        return ExecuteSlideAction("prev", 0);
    }
    public static string GetStatus() {
        return ExecuteSlideAction("status", 0);
    }
    public static string GotoSlide(int index) {
        return ExecuteSlideAction("goto", index);
    }
    public static string GetActivePresentationPath() {
        try {
            dynamic ppt = GetPpt();
            return ppt.ActivePresentation.FullName;
        } catch {
            return "";
        }
    }
    public static string ExportThumbnail(int index, string path) {
        try {
            dynamic ppt = GetPpt();
            dynamic presentation = ppt.ActivePresentation;
            dynamic slide = presentation.Slides[index];
            slide.Export(path, "JPG", 320, 180);
            return "OK";
        } catch (Exception ex) {
            return "ERR: " + ex.Message;
        }
    }

    private static string ExecuteSlideAction(string action, int index) {
        isExecutingCommand = true;
        try {
            dynamic ppt = GetPpt();
            dynamic view = null;
            
            try {
                view = ppt.SlideShowWindows[1].View;
            } catch {
                view = ppt.ActiveWindow.View;
            }
            
            if (action == "next") { view.Next(); System.Threading.Thread.Sleep(50); }
            else if (action == "prev") { view.Previous(); System.Threading.Thread.Sleep(50); }
            else if (action == "goto") { view.GotoSlide(index); System.Threading.Thread.Sleep(50); }
            else if (action == "status") { /* do nothing */ }
            
            dynamic slide = view.Slide;
            int currentSlide = slide.SlideIndex;
            lastKnownSlideIndex = currentSlide;
            int totalSlides = ppt.ActivePresentation.Slides.Count;
            
            string notes = "";
            try {
                notes = slide.NotesPage.Shapes.Placeholders[2].TextFrame.TextRange.Text.Trim();
            } catch {
                try {
                    int shapesCount = slide.NotesPage.Shapes.Count;
                    for (int i = 1; i <= shapesCount; i++) {
                        try {
                            dynamic shape = slide.NotesPage.Shapes[i];
                            if (shape.HasTextFrame == -1 && shape.TextFrame.HasText == -1) {
                                notes += shape.TextFrame.TextRange.Text + "\\n";
                            }
                        } catch {}
                    }
                    notes = notes.Trim();
                } catch {}
            }
            
            string escapedNotes = notes.Replace("\\\\", "\\\\\\\\").Replace("\\\"", "\\\\\\\"").Replace("\\n", "\\\\n").Replace("\\r", "");
            return "{\\"currentSlide\\":" + currentSlide + ",\\"totalSlides\\":" + totalSlides + ",\\"notes\\":\\"" + escapedNotes + "\\"}";
        } catch (Exception ex) {
            return "{\\"error\\":\\"" + ex.Message.Replace("\\\"", "\\\\\\\"").Replace("\\n", "\\\\n").Replace("\\r", "") + "\\"}"; 
        } finally {
            isExecutingCommand = false;
        }
    }

    public static void RunLoop() {
        StartWatcher();
        lock (consoleLock) {
            Console.WriteLine("INIT_OK");
            Console.WriteLine("END_OF_COMMAND");
        }

        while (true) {
            string line = Console.ReadLine();
            if (line == null || line == "exit") break;
            
            string result = "";
            try {
                if (line == "next") result = NextSlide();
                else if (line == "prev") result = PrevSlide();
                else if (line == "status") result = GetStatus();
                else if (line.StartsWith("goto:")) {
                    int index = int.Parse(line.Substring(5));
                    result = GotoSlide(index);
                }
                else if (line.StartsWith("export:")) {
                    string[] parts = line.Substring(7).Split(new char[]{'|'}, 2);
                    int index = int.Parse(parts[0]);
                    result = ExportThumbnail(index, parts[1]);
                }
                else if (line == "path") result = GetActivePresentationPath();
            } catch (Exception ex) {
                result = "{\\"error\\":\\"" + ex.Message.Replace("\\\"", "\\\\\\\"").Replace("\\n", "\\\\n").Replace("\\r", "") + "\\"}";
            }
            
            lock (consoleLock) {
                Console.WriteLine(result);
                Console.WriteLine("END_OF_COMMAND");
            }
        }
    }
}
`;

function initPowerShell() {
    if (process.platform !== 'win32') return;
    if (psProcess) return;
    
    try {
        psProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-']);
    } catch (e) {
        console.warn('PowerShell spawn error:', e.message);
        psProcess = null;
        return;
    }

    psProcess.on('error', (err) => {
        console.warn('PowerShell process error:', err.message);
        psProcess = null;
        isReady = false;
    });
    
    psProcess.stdout.on('data', (data) => {
        outBuffer += data.toString('utf8');
        while (outBuffer.includes('END_OF_COMMAND')) {
            const parts = outBuffer.split('END_OF_COMMAND');
            const result = parts[0].trim();
            outBuffer = parts.slice(1).join('END_OF_COMMAND'); 
            
            if (result.startsWith("ASYNC_STATUS|")) {
                const statusStr = result.substring("ASYNC_STATUS|".length);
                if (module.exports.onAsyncStatus) {
                    module.exports.onAsyncStatus(statusStr);
                }
                continue;
            }
            
            if (result === "INIT_OK") {
                isReady = true;
                if (currentResolve) {
                    currentResolve("INIT_OK");
                    currentResolve = null;
                }
            } else if (currentResolve) {
                currentResolve(result);
                currentResolve = null;
            }
        }
    });
    
    psProcess.stderr.on('data', d => console.error('PS_ERR:', d.toString()));

    psProcess.on('close', () => {
        psProcess = null;
        isReady = false;
    });

    const initScript = `
        Add-Type -TypeDefinition @"
${csharpCode}
"@ -ReferencedAssemblies Microsoft.CSharp
        [PptManager]::RunLoop()
    `;
    
    // We will wait for INIT_OK
    try {
        psProcess.stdin.write(initScript + '\n');
    } catch (e) {}
}

function runCommand(commandStr) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            return resolve("{}");
        }
        initPowerShell();
        
        let timeout = setTimeout(() => {
            if (currentResolve === resolve) {
                currentResolve = null;
                resolve("{}");
            }
        }, 5000);

        const tryExecute = () => {
            if (isReady && !currentResolve) {
                currentResolve = (res) => {
                    clearTimeout(timeout);
                    resolve(res);
                };
                outBuffer = "";
                psProcess.stdin.write(commandStr + '\n');
            } else if (!psProcess) {
                clearTimeout(timeout);
                resolve("{}");
            } else {
                setTimeout(tryExecute, 10);
            }
        };
        tryExecute();
    });
}

async function nextSlideAndGetNotes() {
    return await runCommand(`next`);
}

async function prevSlideAndGetNotes() {
    return await runCommand(`prev`);
}

async function getStatus() {
    return await runCommand(`status`);
}

async function gotoSlide(index) {
    return await runCommand(`goto:${index}`);
}

async function exportThumbnail(index, path) {
    return await runCommand(`export:${index}|${path}`);
}

async function getActivePresentationPath() {
    return await runCommand(`path`);
}

module.exports = {
    nextSlideAndGetNotes,
    prevSlideAndGetNotes,
    getStatus,
    gotoSlide,
    exportThumbnail,
    getActivePresentationPath
};
