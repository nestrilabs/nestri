---
title: 'Technical Deep Dive into Latency'
description: "Why It's High and How to Reduce It"
pubDate: 'May 18 2025'
heroImage: '/pexels-brett-sayles-2881224.jpg'
---

### Why It's High and How to Reduce It

First, let's start with the basics of the Internet.

The Internet connects clients and servers. Webpages primarily use the Application Layer protocol HTTP(S) to communicate with servers. HTTP is widely adopted for various applications, including mobile apps and other services requiring server communication.

There are also other client protocols like WebRTC (Web Real-Time Communication), which mainly powers streaming services needing a back channel. Nestri utilizes WebRTC, and we'll delve deeper into that later.

Imagine using a client protocol like WebRTC to send messages. Common formats for these messages include XML, HTML, or JSON.

While HTML contains significant duplicate symbols (e.g., `<a href="example.com">Some Link</a> <a href="example.com/subpage">Some nested Link</a>`), the modern web employs techniques to reduce its size. For instance, using modern zipping algorithms like gzip, this data can be compressed, resulting in a smaller size for transmission over the HTTP protocol.

In computer science, the more dense the information in a message (achieved through compression, for example), the higher its message entropy. Therefore, sending messages with high entropy is beneficial as it allows for the transfer of more information in a smaller package. Pure HTTP has relatively low entropy, similar to XML. JSON offers higher entropy, which can be further increased by removing whitespace and shortening attribute names. However, in modern client-server applications, JSON is often compressed.

So, we compress JSON traffic for efficiency. Have you ever compressed a large file? Modern systems make this process incredibly fast! But this requires computing power on both the client and server sides, which directly influences latency.

"Well, if I have a fiber connection, I don't need to worry about that..."

While a fiber connection offers significant bandwidth, this statement is somewhat misleading.

Latency also depends on your local network. A modern and stable Wi-Fi connection might seem sufficient, but the physical layer of the internet also contributes to latency. Wireless protocols, in particular, operate on a shared medium – the air. This medium is utilized by various devices, commonly on frequencies around 2.4 or 5 GHz. This spectrum is divided among all these devices. Mechanisms like scheduling and signal modulation are used to manage this shared resource. In essence, to avoid a deeper dive into wireless communication, a wired connection is generally superior to a wireless connection due to the absence of a shared physical medium.

Okay, but what about Ethernet or fiber cables? Aren't we sharing those as well, with multiple applications or other internet users?

Yes, this also impacts latency. If many users in your local area are utilizing the same uplinks to a backbone (a high-speed part of the internet), you'll have to share that bandwidth. While fiber optic cables have substantial capacity due to advanced modulation techniques, consider the journey these data packets undertake across the internet.

Sometimes, if a data center is located nearby, your connection will involve fewer routers (fewer hops) between you and the server. Fewer hops generally translate to lower latency. Each router needs to queue your messages and determine the next destination. Modern routing protocols facilitate this process. However, even routers have to process messages in their queues. Thus, higher message entropy means fewer or smaller packets need to be sent.

What happens when your messages are too large for transmission? They are split into multiple parts and sent using protocols like TCP. TCP ensures reliable packet exchange by retransmitting any packets that are likely lost during internet transit. Packet loss can occur if a router's queue overflows, forcing it to drop packets, potentially prioritizing other traffic. This retransmission significantly increases latency as a packet might need to be sent multiple times.

UDP offers a different approach: it sends all packets without the overhead of retransmission. In this case, the application protocol is responsible for handling any lost packets. Fortunately, there's an application protocol that manages this quite effectively: WebRTC.

WebRTC is an open-source project providing APIs for real-time communication of audio, video, and generic data between peers via a browser. It leverages protocols like ICE, STUN, and TURN to handle NAT traversal and establish peer-to-peer connections, enabling low-latency media streaming and data exchange directly within web applications.

Sending raw video streams over WebRTC is inefficient; they require compression using modern codecs. A GPU is the optimal choice for this task because it has dedicated hardware (hardware encoder) to accelerate video encoding, significantly speeding up the process compared to software encoding on a CPU. Therefore, your GPU also plays a crucial role in reducing latency during video encoding and decoding.

So, why is all this relevant to Nestri?

We aim to deliver a cutting-edge, low-latency cloud gaming experience. Here's what we've implemented to combat bad latency:

**1. Reducing Mouse and Keyboard Latency**
   1. Reduce package size by using the Protobuf protocol instead of JSON.
   2. Avoid wasting compute power by not compressing these already optimized messages.
   3. Minimize message flooding by bundling multiple mouse events into fewer messages through aggregation.
   4. Implement all of this within WebRTC for a super lightweight communication over UDP.

**2. Reducing Video Latency**
   1. Utilize cutting-edge encoder-decoders on a GPU instead of a CPU.

**3. Reducing Network Latency in the Backbone**
   1. Bring servers closer to users to reduce the hop count.

Here's a glimpse of the results of these improvements, comparing the experience before and after implementation:

![[nestri footage video](/nestri-footage-latency.png)](https://fs.dathorse.com/w/ad2bee7e322b942491044fcffcccc899)
**Latency Test and comparison to the old Nestri**

Did you enjoy this blog post? Join our Discord and share your thoughts!