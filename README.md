<div align="center">
<h1>

<a href="https://nestri.io" >
<img src="/apps/www/public/seo/banner.png" alt="Nestri - What will you play next?">
</a>

</h1>
</div>

&nbsp;
&nbsp;

Welcome to **Nestri**, a cutting-edge cloud gaming web streaming platform that allows users to play high-performance games directly from their browsers—no downloads or installations required! 🚀</strong>
<br/>
<br/>

</div>

<div align="center">

[![][github-release-shield]][github-release-link]
[![][discord-shield]][discord-link]
[![][github-license-shield]][github-license-link]
[![][github-stars-shield]][github-stars-link]

**Share the Nestri Repository on Social Media**

[![][share-x-shield]][share-x-link]
[![][share-reddit-shield]][share-reddit-link]

</div>
&nbsp;
&nbsp;

## 📌 Features
- 🎮 **Play Instantly**: Stream games on any device with a chromium browser.
- ☁ **Cloud-Powered**: You can use our whole hosted service without any self-hosting hassle
- 🧰 **BYOG**: You can user our infrastructure and bring your own gpu server that is running under your desk or in your rack at home
- 🛠 **Self-Host**: You can host the whole stack on your own if you want to
- ⚡ **Low Latency**: Optimized for high-speed performance.
- 🎥 **HD Streaming**: Supports up to 1080p resolution.
- 🕹 **Controller Support**: ➞ *planned soon*
- 🎉 **Share with your friends & family**: You can share your gaming rig with your firends or family

## 📦 Installation & Setup
### 🔧 Prerequisites for BYOG
Ensure you have the following installed:
- Linux e.g. Ubuntu/Fedora/Arch
- [Docker](https://www.docker.com/get-started) or [Podman](https://podman.io/get-started)
- A Nvidia, Intel or AMD GPU in your machine
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) (NVIDIA GPU only)

### 🚀 Quick Start
➞ *coming soon*

## 🏗 Architecture Overview
```
┌───────────────────────┐
│     User Browser      │
└────────▲──────────────┘
         │ WebRTC Streaming
┌────────▼──────────────┐
│   Nestri Relay        │
└────────▲──────────────┘
         │ WebRTC forwarding (NAT Traversal)
┌────────▼──────────────┐
│   Nestri Runner       │
└───────────────────────┘
```


## 🛠 Documentation
To build and run the docs:
```sh
cd apps/docs/
bun install
bun run dev
```

## 🤝 Contributing
We welcome contributions! Please fork the repository and submit a pull request.
If you find a bug or have an idea feel free to create an [issue](https://github.com/nestrilabs/nestri/issues)

## 💵 Sponsoring
We'd be incredibly grateful for any support - whether it's a contribution, donation, sharing our product, or simply cheering us on. Every bit helps us get closer to our goal of an open source cloud gaming platform! Thank you for believing in us!

We would highly appreciate your sponsoring on [Polar](https://polar.sh/nestri) 
🫶

## 📜 License
This project is licensed under the AGPL-3.0 license - see the [LICENSE](https://github.com/nestrilabs/nestri?tab=AGPL-3.0-1-ov-file#readme) file for details.

## 🌐 Links & Resources
- [Official Website](https://nestri.io)
- [Documentation](https://github.com/nestrilabs/nestri/tree/main/apps/docs)
- [Discord Community](https://discord.com/invite/Y6etn3qKZ3)
- [Polar](https://polar.sh/nestri)

Happy Gaming! 🎮🔥


[github-release-link]: https://github.com/nestriness/nestri/releases
[github-release-shield]: https://img.shields.io/github/v/release/nestriness/nestri?color=369eff&labelColor=black&logo=github&style=flat-square
[discord-shield]: https://img.shields.io/discord/1080111004698021909?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square
[discord-link]: https://discord.com/invite/Y6etn3qKZ3
[github-license-shield]: https://img.shields.io/github/license/nestriness/nestri?color=white&labelColor=black&style=flat-square
[github-license-link]: https://github.com/nestriness/nestri/blob/main/LICENSE
[github-stars-shield]: https://img.shields.io/github/stars/nestriness/nestri?color=ffcb47&labelColor=black&style=flat-square
[github-stars-link]: https://github.com/nestriness/nestri/network/stargazers
[share-x-shield]: https://img.shields.io/badge/-share%20on%20x-black?labelColor=black&logo=x&logoColor=white&style=flat-square
[share-x-link]: https://twitter.com/intent/tweet?text=Hey%2C%20check%20out%20this%20Github%20repository.%20It%20is%20an%20open-source%20self-hosted%20Geforce%20Now%20alternative.&url=https%3A%2F%2Fgithub.com%2Fnestriness%2Fnestri
[share-reddit-shield]: https://img.shields.io/badge/-share%20on%20reddit-black?labelColor=black&logo=reddit&logoColor=white&style=flat-square
[share-reddit-link]: https://www.reddit.com/submit?title=Hey%2C%20check%20out%20this%20Github%20repository.%20It%20is%20an%20open-source%20self-hosted%20Geforce%20Now%20alternative.&url=https%3A%2F%2Fgithub.com%2Fnestriness%2Fnestri
[image-overview]: assets/banner.png
[website-link]: https://nestri.io
[neko-url]: https://github.com/m1k1o/neko
[image-star]: assets/star-us.png
[moq-github-url]: https://quic.video
[vmaf-cuda-link]: https://developer.nvidia.com/blog/calculating-video-quality-using-nvidia-gpus-and-vmaf-cuda/
