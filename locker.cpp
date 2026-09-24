// locker.cpp — front-end for the folder locker. The heavy lifting (walking a folder, AES-256-GCM
// encryption/decryption, key derivation) lives in locker-engine.js, using Node's own crypto instead of
// hand-rolled C++ crypto. This program captures the secret "unlock function" (a JavaScript function
// only the owner knows), hands it to the engine through a temp file, relays the engine's message, and
// exits with the engine's exit code.
//
// What actually protects the data: a locked folder holds AES-256-GCM ciphertext, not code. Without
// the secret, nothing — VS Code, Explorer, another user, an AI agent, a hacker with full disk access
// — can read it. That is real protection, unlike a permission flag or a check inside the code, both
// of which the same Windows account could simply undo.
//
// What it cannot do: it is not an always-running guard (that needs an installed service, which was
// ruled out), so it cannot pop up a prompt the instant something tries to open a folder — you lock
// and unlock deliberately. A folder is only protected while locked; while unlocked it's plain files.
//
// Build with -O1: this project's GCC 16.1.0 build miscompiled at -O2 (see README).
//
//   locker setup  [folder] [secretfile.js]   record the secret for a folder (creates .locker/)
//   locker lock   [folder] [secretfile.js]   encrypt every file in the folder
//   locker unlock [folder] [secretfile.js]   decrypt everything back
//   locker status [folder]                   locked / unlocked (no secret needed)

#include <windows.h>

#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace {

std::string trim(const std::string &s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

/** Directory containing this executable (locker-engine.js lives next to it). */
std::string exeDir() {
    char buf[MAX_PATH];
    DWORD n = GetModuleFileNameA(nullptr, buf, MAX_PATH);
    std::string full(buf, n);
    size_t slash = full.find_last_of("\\/");
    return slash == std::string::npos ? "." : full.substr(0, slash);
}

std::string stripTrailingSlashes(std::string p) {
    while (p.size() > 1 && (p.back() == '\\' || p.back() == '/')) p.pop_back();
    return p;
}

bool fileExists(const std::string &path) {
    std::ifstream f(path);
    return static_cast<bool>(f);
}

std::string readSecretFromStdin() {
    std::cout << "তোমার আনলক ফাংশনটা পেস্ট করো। শেষ হলে একটা নতুন লাইনে লিখো: ###END###\n> ";
    std::string line, all;
    while (std::getline(std::cin, line)) {
        if (trim(line) == "###END###") break;
        all += line;
        all += "\n";
    }
    return all;
}

/** Runs the engine and returns its exit code; its stdout (minus the RESULT: line) goes to the user. */
int runEngine(const std::string &mode, const std::string &folder, const std::string &secretFile) {
    std::string cmd = "node \"" + exeDir() + "\\locker-engine.js\" " + mode + " \"" + folder + "\"";
    if (!secretFile.empty()) cmd += " \"" + secretFile + "\"";
    cmd += " 2>&1";

    FILE *pipe = _popen(cmd.c_str(), "r");
    if (!pipe) {
        std::cerr << "node চালানো যায়নি — Node.js ইনস্টল আছে তো?\n";
        return 1;
    }
    std::string out;
    char buf[512];
    while (fgets(buf, sizeof(buf), pipe)) out += buf;
    int code = _pclose(pipe);

    // Drop the machine-readable first line ("RESULT:TOKEN"), print the human message after it.
    size_t nl = out.find('\n');
    if (out.rfind("RESULT:", 0) == 0 && nl != std::string::npos) out = out.substr(nl + 1);
    std::cout << out;
    if (!out.empty() && out.back() != '\n') std::cout << "\n";
    return code;
}

/** Captures the secret (file argument, or pasted on stdin), runs the engine, always cleans up the temp file. */
int runWithSecret(const std::string &mode, const std::string &folder, const std::string &secretFileArg) {
    std::string secretPath = secretFileArg;
    bool ownTemp = false;

    if (secretPath.empty()) {
        std::string text = readSecretFromStdin();
        const char *tmp = std::getenv("TEMP");
        if (!tmp) tmp = ".";
        secretPath = std::string(tmp) + "\\locker_secret_" + std::to_string(std::time(nullptr)) + "_" +
                     std::to_string(std::clock()) + ".js";
        std::ofstream out(secretPath);
        out << text;
        out.close();
        ownTemp = true;
    } else if (!fileExists(secretPath)) {
        std::cerr << "❌ ফাইল পাওয়া যায়নি: " << secretPath << "\n";
        return 1;
    }

    int code = runEngine(mode, folder, secretPath);
    if (ownTemp) std::remove(secretPath.c_str()); // never leave the secret function lying around
    return code;
}

void printHelp() {
    std::cout <<
        "locker setup  [folder] [secretfile.js]   এই ফোল্ডারের জন্য secret বসাও\n"
        "locker lock   [folder] [secretfile.js]   ফোল্ডারের সব ফাইল এনক্রিপ্ট করো\n"
        "locker unlock [folder] [secretfile.js]   সব ফাইল আবার আগের মতো করো\n"
        "locker status [folder]                    এখন locked না unlocked (secret লাগে না)\n"
        "\n"
        "folder না দিলে বর্তমান ফোল্ডার ধরা হয়।\n";
}

} // namespace

int main(int argc, char **argv) {
    std::string mode = argc > 1 ? argv[1] : "";
    std::string folder = argc > 2 ? stripTrailingSlashes(argv[2]) : ".";
    std::string secretFileArg = argc > 3 ? argv[3] : "";

    if (mode == "status") return runEngine("status", folder, "");

    if (mode == "setup") {
        if (fileExists(folder + "\\.locker\\config.json")) {
            std::cout << "এই ফোল্ডারে আগে থেকেই একটা secret আছে। নতুন করে বসাবে? (yes লিখো নিশ্চিত করতে): ";
            std::string confirm;
            std::getline(std::cin, confirm);
            if (trim(confirm) != "yes") {
                std::cout << "বাতিল করা হলো।\n";
                return 0;
            }
        }
        return runWithSecret("setup", folder, secretFileArg);
    }

    if (mode == "lock" || mode == "unlock") {
        std::cout << "🔒 LOCKER\nGive me code, I will eat, and then I will work for you.\n\n";
        return runWithSecret(mode, folder, secretFileArg);
    }

    printHelp();
    return mode.empty() || mode == "--help" || mode == "-h" ? 0 : 1;
}
