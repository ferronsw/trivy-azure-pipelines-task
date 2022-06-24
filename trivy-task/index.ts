import * as os from 'os';
import * as util from 'util';
import * as tool from 'azure-pipelines-tool-lib';
import {ToolRunner} from 'azure-pipelines-task-lib/toolrunner';
import task = require('azure-pipelines-task-lib/task');

const latestTrivyVersion = "v0.29.2"
const tmpPath = "/tmp/"

async function run() {

    console.log("Preparing output location...")
    let outputPath = tmpPath + "trivy-results-" + Math.random() + ".json";
    task.rmRF(outputPath);

    let scanPath = task.getInput("path", false)
    let image = task.getInput("image", false)

    if (scanPath === undefined && image === undefined) {
        throw new Error("You must specify something to scan. Use either the 'image' or 'path' option.")
    }
    if (scanPath !== undefined && image !== undefined) {
        throw new Error("You must specify only one of the 'image' or 'path' options. Use multiple task definitions if you want to scan multiple targets.")
    }

    const runner = await createRunner(task.getBoolInput("docker", false));

    if (task.getBoolInput("debug", false)) {
        runner.arg("--debug")
    }

    if (scanPath !== undefined) {
        configureScan(runner, "fs", scanPath, outputPath)
    } else if (image !== undefined) {
        configureScan(runner, "image", image, outputPath)
    }

    console.log("Running Trivy...")
    let result = runner.execSync();
    if (result.code === 0) {
        task.setResult(task.TaskResult.Succeeded, "No problems found.")
    } else {
        task.setResult(task.TaskResult.Failed, "Failed: Trivy detected problems.")
    }

    console.log("Publishing JSON results...")
    task.addAttachment("JSON_RESULT", "trivy-" +  Math.random() + ".json", outputPath)
    console.log("Done!");
}

async function createRunner(docker: boolean): Promise<ToolRunner> {
    const version: string | undefined = task.getInput('version', true);
    if (version === undefined) {
        throw new Error("version is not defined")
    }

    if (!docker) {
        console.log("Run requested using local Trivy binary...")
        const trivyPath = await installTrivy(version)
        return task.tool(trivyPath);
    }

    console.log("Run requested using docker...")
    const runner = task.tool("docker");
    const home = require('os').homedir();
    const cwd = process.cwd()

    runner.line("run --rm")
    runner.line("-v " + home + "/.docker/config.json:/root/.docker/config.json")
    runner.line("-v /tmp:/tmp")
    runner.line("-v " + cwd + ":/src")
    runner.line("--workdir /src")
    runner.line("aquasec/trivy:" + stripV(version))
    return runner
}

function configureScan(runner: ToolRunner, type: string, target: string, outputPath: string) {
    console.log("Configuring options for image scan...")
    let exitCode = task.getInput("exitCode", false)
    if (exitCode === undefined) {
        exitCode = "1"
    }
    runner.arg([type]);
    runner.arg(["--exit-code", exitCode]);
    runner.arg(["--format", "json"]);
    runner.arg(["--output", outputPath]);
    runner.arg(["--security-checks", "vuln,config,secret"])
    runner.arg(target)
}

async function installTrivy(version: string): Promise<string> {

    console.log("Finding correct Trivy version to install...")

    if (os.platform() == "win32") {
        throw new Error("Windows is not currently supported")
    }
    if (os.platform() != "linux") {
        throw new Error("Only Linux is currently supported")
    }

    let url = await getArtifactURL(version)

    let bin = "trivy"

    let localPath = tmpPath + bin;
    task.rmRF(localPath);

    console.log("Downloading Trivy...")
    let downloadPath = await tool.downloadTool(url, localPath);

    console.log("Extracting Trivy...")
    await tool.extractTar(downloadPath, tmpPath)
    const binPath = tmpPath + bin

    console.log("Setting permissions...")
    await task.exec('chmod', ["+x", binPath]);
    return binPath
}

function stripV(version: string): string {
    if (version.length > 0 && version[0] === 'v') {
        version = version?.substring(1)
    }
    return version
}

async function getArtifactURL(version: string): Promise<string> {
    if(version === "latest") {
        version = latestTrivyVersion
    }
    console.log("Required Trivy version is " + version)
    let arch = ""
    switch (os.arch()) {
        case "arm":
            arch = "ARM"
            break
        case "arm64":
            arch = "ARM64"
            break
        case "x32":
            arch = "32bit"
            break
        case "x64":
            arch = "64bit"
            break
        default:
            throw new Error("unsupported architecture: " + os.arch())
    }
    // e.g. trivy_0.29.1_Linux-ARM.tar.gz
    let artifact: string = util.format("trivy_%s_Linux-%s.tar.gz", stripV(version), arch);
    return util.format("https://github.com/aquasecurity/trivy/releases/download/%s/%s", version, artifact);
}

run().catch((err: Error) => {
    task.setResult(task.TaskResult.Failed, err.message);
})
