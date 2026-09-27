// The C++ reference, for nespyro's cross-check tests.
//
// A thin command-line wrapper over PyroWave's C API at the commit nespyro's
// bitstream is frozen at. It moves 8-bit planar YCbCr and packet files, so the
// Rust tests can hand it their input and compare what comes out.
//
// A packet file is a sequence of packets, each a little-endian u32 length and
// that many bytes.
//
//   harness encode W H 420|444 MAX_BYTES PACKET_SIZE in.yuv out.pkts
//   harness decode W H 420|444 in.pkts out.yuv
//   harness bench  W H 420|444 MAX_BYTES FRAMES in.yuv
//
// NESPYRO_REFERENCE_VID picks the device by PCI vendor ID (hex); otherwise the
// first Vulkan device.

#include <vulkan/vulkan.h>
#include "pyrowave.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void die(const char *what, int code = 1)
{
	fprintf(stderr, "harness: %s\n", what);
	exit(code);
}

static std::vector<uint8_t> read_file(const char *path)
{
	FILE *f = fopen(path, "rb");
	if (!f)
		die("cannot open input");
	std::vector<uint8_t> data;
	uint8_t buf[65536];
	size_t n;
	while ((n = fread(buf, 1, sizeof(buf), f)) > 0)
		data.insert(data.end(), buf, buf + n);
	fclose(f);
	return data;
}

static void write_file(const char *path, const std::vector<uint8_t> &data)
{
	FILE *f = fopen(path, "wb");
	if (!f || fwrite(data.data(), 1, data.size(), f) != data.size())
		die("cannot write output");
	fclose(f);
}

struct Planes
{
	int width, height;
	bool yuv444;
	std::vector<uint8_t> data;

	int chroma_width() const { return yuv444 ? width : width / 2; }
	int chroma_height() const { return yuv444 ? height : height / 2; }
	size_t luma_size() const { return size_t(width) * height; }
	size_t chroma_size() const { return size_t(chroma_width()) * chroma_height(); }
	size_t total() const { return luma_size() + 2 * chroma_size(); }

	pyrowave_cpu_buffer buffer()
	{
		pyrowave_cpu_buffer b = {};
		b.format = yuv444 ? PYROWAVE_CPU_BUFFER_FORMAT_YUV444P : PYROWAVE_CPU_BUFFER_FORMAT_YUV420P;
		b.width = width;
		b.height = height;
		b.data[0] = data.data();
		b.data[1] = data.data() + luma_size();
		b.data[2] = data.data() + luma_size() + chroma_size();
		b.row_stride_in_bytes[0] = width;
		b.row_stride_in_bytes[1] = chroma_width();
		b.row_stride_in_bytes[2] = chroma_width();
		b.plane_size_in_bytes[0] = luma_size();
		b.plane_size_in_bytes[1] = chroma_size();
		b.plane_size_in_bytes[2] = chroma_size();
		return b;
	}
};

static pyrowave_device make_device()
{
	uint32_t vid = 0;
	if (const char *v = getenv("NESPYRO_REFERENCE_VID"))
		vid = uint32_t(strtoul(v, nullptr, 16));
	pyrowave_device device = nullptr;
	if (pyrowave_create_device_by_compat(vid, 0, nullptr, nullptr, nullptr, &device) != PYROWAVE_SUCCESS)
		die("no device", 2);
	return device;
}

static pyrowave_encoder make_encoder(pyrowave_device device, int w, int h, bool yuv444)
{
	pyrowave_encoder_create_info info = {};
	info.device = device;
	info.width = w;
	info.height = h;
	info.chroma = yuv444 ? PYROWAVE_CHROMA_SUBSAMPLING_444 : PYROWAVE_CHROMA_SUBSAMPLING_420;
	pyrowave_encoder encoder = nullptr;
	if (pyrowave_encoder_create(&info, &encoder) != PYROWAVE_SUCCESS)
		die("encoder create failed", 3);
	return encoder;
}

static void print_stats(void *, const char *msg)
{
	fputs(msg, stdout);
}

int main(int argc, char **argv)
{
	if (argc < 5)
		die("usage: harness encode|decode|bench W H 420|444 ...");
	std::string cmd = argv[1];
	Planes p;
	p.width = atoi(argv[2]);
	p.height = atoi(argv[3]);
	p.yuv444 = std::string(argv[4]) == "444";

	pyrowave_device device = make_device();

	if (cmd == "encode" || cmd == "bench")
	{
		if (argc < 8)
			die("usage: harness encode W H C MAX_BYTES PACKET_SIZE|FRAMES in out?");
		size_t max_bytes = strtoull(argv[5], nullptr, 10);
		p.data = read_file(argv[7]);
		if (p.data.size() != p.total())
			die("input is not W x H planar YCbCr");
		pyrowave_encoder encoder = make_encoder(device, p.width, p.height, p.yuv444);
		pyrowave_cpu_buffer buffer = p.buffer();
		pyrowave_rate_control rate = { max_bytes };

		if (cmd == "bench")
		{
			int frames = atoi(argv[6]);
			for (int i = 0; i < frames; i++)
				if (pyrowave_encoder_encode_cpu_synchronous(encoder, &buffer, &rate) != PYROWAVE_SUCCESS)
					die("encode failed", 4);
			// Upstream's own GPU timestamps, per pass.
			pyrowave_device_report_performance_stats(device, print_stats, nullptr, true);
			pyrowave_encoder_destroy(encoder);
			return 0;
		}

		if (argc < 9)
			die("usage: harness encode W H C MAX_BYTES PACKET_SIZE in.yuv out.pkts");
		size_t packet_size = strtoull(argv[6], nullptr, 10);
		if (pyrowave_encoder_encode_cpu_synchronous(encoder, &buffer, &rate) != PYROWAVE_SUCCESS)
			die("encode failed", 4);
		size_t count = 0;
		if (pyrowave_encoder_compute_num_packets(encoder, packet_size, &count) != PYROWAVE_SUCCESS)
			die("packet count failed", 4);
		std::vector<pyrowave_packet> packets(count);
		std::vector<uint8_t> bitstream(max_bytes + (1 << 20));
		if (pyrowave_encoder_packetize(encoder, packets.data(), packet_size, &count,
		                               bitstream.data(), bitstream.size()) != PYROWAVE_SUCCESS)
			die("packetize failed", 4);
		std::vector<uint8_t> out;
		for (size_t i = 0; i < count; i++)
		{
			uint32_t len = uint32_t(packets[i].size);
			out.insert(out.end(), reinterpret_cast<uint8_t *>(&len), reinterpret_cast<uint8_t *>(&len) + 4);
			out.insert(out.end(), bitstream.begin() + packets[i].offset,
			           bitstream.begin() + packets[i].offset + packets[i].size);
		}
		write_file(argv[8], out);
		pyrowave_encoder_destroy(encoder);
		return 0;
	}

	if (cmd == "decode")
	{
		if (argc < 7)
			die("usage: harness decode W H C in.pkts out.yuv");
		std::vector<uint8_t> pkts = read_file(argv[5]);
		pyrowave_decoder_create_info info = {};
		info.device = device;
		info.width = p.width;
		info.height = p.height;
		info.chroma = p.yuv444 ? PYROWAVE_CHROMA_SUBSAMPLING_444 : PYROWAVE_CHROMA_SUBSAMPLING_420;
		info.fragment_path = false;
		pyrowave_decoder decoder = nullptr;
		if (pyrowave_decoder_create(&info, &decoder) != PYROWAVE_SUCCESS)
			die("decoder create failed", 3);
		size_t at = 0;
		while (at + 4 <= pkts.size())
		{
			uint32_t len;
			memcpy(&len, pkts.data() + at, 4);
			at += 4;
			if (at + len > pkts.size())
				die("truncated packet file");
			if (pyrowave_decoder_push_packet(decoder, pkts.data() + at, len) != PYROWAVE_SUCCESS)
				die("the reference decoder refused a packet", 5);
			at += len;
		}
		if (!pyrowave_decoder_decode_is_ready(decoder, false))
			die("the reference decoder says the frame is incomplete", 5);
		p.data.resize(p.total());
		pyrowave_cpu_buffer buffer = p.buffer();
		if (pyrowave_decoder_decode_cpu_buffer_synchronous(decoder, &buffer) != PYROWAVE_SUCCESS)
			die("decode failed", 4);
		write_file(argv[6], p.data);
		pyrowave_decoder_destroy(decoder);
		return 0;
	}

	die("unknown command");
}
