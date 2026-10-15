#!/usr/bin/env python3
"""Dependency-free APK build with official Android SDK 35 tools and JDK 17+.
SDK packages: platforms;android-35, build-tools;35.0.0. Signing material is kept
outside Git. Build the same sources with Android Studio/Gradle if preferred.
"""
import argparse, os, pathlib, shutil, subprocess, tempfile, zipfile, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME', ''))
parser.add_argument('--keystore', required=True)
parser.add_argument('--password-file', required=True)
parser.add_argument('--out', default=str(ROOT/'app/build/ai-chats-1.0.1.apk'))
args = parser.parse_args()
sdk = pathlib.Path(args.sdk).resolve(); tools = sdk/'build-tools/35.0.0'; android = sdk/'platforms/android-35/android.jar'
if not android.is_file(): raise SystemExit('Install platforms;android-35 and build-tools;35.0.0 first.')
out = pathlib.Path(args.out).resolve(); out.parent.mkdir(parents=True, exist_ok=True)
def run(*cmd): subprocess.run([str(x) for x in cmd], check=True)
with tempfile.TemporaryDirectory(prefix='ai-chats-build-') as temp:
    build = pathlib.Path(temp); generated = build/'generated'; generated.mkdir()
    classes = build/'classes'; classes.mkdir(); dex = build/'dex'; dex.mkdir()
    manifest = ET.parse(ROOT/'app/src/main/AndroidManifest.xml'); manifest.getroot().set('package', 'ai.chats.mobile')
    manifest.write(build/'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    run(tools/'aapt2', 'compile', '--dir', ROOT/'app/src/main/res', '-o', build/'resources.zip')
    run(tools/'aapt2', 'link', '-o', build/'unsigned.apk', '-I', android, '--manifest', build/'AndroidManifest.xml',
        '--java', generated, '-A', ROOT/'app/src/main/assets', '--min-sdk-version', '26', '--target-sdk-version', '35', '--version-code', '2', '--version-name', '1.0.1', build/'resources.zip')
    sources = sorted((ROOT/'app/src/main/java').rglob('*.java')) + sorted(generated.rglob('*.java'))
    boot = str(tools/'core-lambda-stubs.jar') + os.pathsep + str(android)
    run('java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', boot, '-d', classes, *sources)
    run('java', '-m', 'jdk.jartool/sun.tools.jar.Main', 'cf', build/'classes.jar', '-C', classes, '.')
    run(tools/'d8', '--release', '--min-api', '26', '--lib', android, '--output', dex, build/'classes.jar')
    with zipfile.ZipFile(build/'unsigned.apk', 'a') as archive:
        for item in sorted(dex.glob('*.dex')): archive.write(item, item.name)
    run(tools/'zipalign', '-f', '4', build/'unsigned.apk', build/'aligned.apk')
    run(tools/'apksigner', 'sign', '--ks', pathlib.Path(args.keystore).resolve(), '--ks-key-alias', 'aichats',
        '--ks-pass', 'file:'+str(pathlib.Path(args.password_file).resolve()), '--out', out, build/'aligned.apk')
    run(tools/'apksigner', 'verify', '--verbose', out)
    run(tools/'zipalign', '-c', '4', out)
print(out)
