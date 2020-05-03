/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A reader which automatically handles the given input stream, returning
 * strictly received packets as array buffers. Note that this object will
 * overwrite any installed event handlers on the given InputStream.
 *
 * @constructor
 * @param {InputStream} stream The stream that data will be read
 *                                       from.
 */
function ArrayBufferReader(stream) {

    /**
     * Reference to this InputStream.
     * @private
     */
    var guac_reader = this;

    // Receive blobs as array buffers
    stream.onblob = function(data) {

        // Convert to ArrayBuffer
        var binary = window.atob(data);
        var arrayBuffer = new ArrayBuffer(binary.length);
        var bufferView = new Uint8Array(arrayBuffer);

        for (var i=0; i<binary.length; i++)
            bufferView[i] = binary.charCodeAt(i);

        // Call handler, if present
        if (guac_reader.ondata)
            guac_reader.ondata(arrayBuffer);

    };

    // Simply call onend when end received
    stream.onend = function() {
        if (guac_reader.onend)
            guac_reader.onend();
    };

    /**
     * Fired once for every blob of data received.
     *
     * @event
     * @param {ArrayBuffer} buffer The data packet received.
     */
    this.ondata = null;

    /**
     * Fired once this stream is finished and no further data will be written.
     * @event
     */
    this.onend = null;

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A writer which automatically writes to the given output stream with arbitrary
 * binary data, supplied as ArrayBuffers.
 *
 * @constructor
 * @param {OutputStream} stream The stream that data will be written
 *                                        to.
 */
function ArrayBufferWriter(stream) {

    /**
     * Reference to this StringWriter.
     * @private
     */
    var guac_writer = this;

    // Simply call onack for acknowledgements
    stream.onack = function(status) {
        if (guac_writer.onack)
            guac_writer.onack(status);
    };

    /**
     * Encodes the given data as base64, sending it as a blob. The data must
     * be small enough to fit into a single blob instruction.
     *
     * @private
     * @param {Uint8Array} bytes The data to send.
     */
    function __send_blob(bytes) {

        var binary = "";

        // Produce binary string from bytes in buffer
        for (var i=0; i<bytes.byteLength; i++)
            binary += String.fromCharCode(bytes[i]);

        // Send as base64
        stream.sendBlob(window.btoa(binary));

    }

    /**
     * Sends the given data.
     *
     * @param {ArrayBuffer|TypedArray} data The data to send.
     */
    this.sendData = function(data) {

        var bytes = new Uint8Array(data);

        // If small enough to fit into single instruction, send as-is
        if (bytes.length <= 8064)
            __send_blob(bytes);

        // Otherwise, send as multiple instructions
        else {
            for (var offset=0; offset<bytes.length; offset += 8064)
                __send_blob(bytes.subarray(offset, offset + 8094));
        }

    };

    /**
     * Signals that no further text will be sent, effectively closing the
     * stream.
     */
    this.sendEnd = function() {
        stream.sendEnd();
    };

    /**
     * Fired for received data, if acknowledged by the server.
     * @event
     * @param {Status} status The status of the operation.
     */
    this.onack = null;

}

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Implementation of AudioPlayer providing support for raw PCM format
 * audio. This player relies only on the Web Audio API and does not require any
 * browser-level support for its audio formats.
 *
 * @constructor
 * @augments AudioPlayer
 * @param {InputStream} stream
 *     The InputStream to read audio data from.
 *
 * @param {String} mimetype
 *     The mimetype of the audio data in the provided stream, which must be a
 *     "audio/L8" or "audio/L16" mimetype with necessary parameters, such as:
 *     "audio/L16;rate=44100,channels=2".
 */
function RawAudioPlayer(stream, mimetype) {

    /**
     * The format of audio this player will decode.
     *
     * @private
     * @type {RawAudioPlayer._Format}
     */
    var format = RawAudioPlayer._Format.parse(mimetype);

    /**
     * An instance of a Web Audio API AudioContext object, or null if the
     * Web Audio API is not supported.
     *
     * @private
     * @type {AudioContext}
     */
    var context = (function getAudioContext() {

        // Fallback to Webkit-specific AudioContext implementation
        var AudioContext = window.AudioContext || window.webkitAudioContext;

        // Get new AudioContext instance if Web Audio API is supported
        if (AudioContext) {
            try {
                return new AudioContext();
            }
            catch (e) {
                // Do not use Web Audio API if not allowed by browser
            }
        }

        // Web Audio API not supported
        return null;

    })();

    /**
     * The earliest possible time that the next packet could play without
     * overlapping an already-playing packet, in seconds. Note that while this
     * value is in seconds, it is not an integer value and has microsecond
     * resolution.
     *
     * @private
     * @type {Number}
     */
    var nextPacketTime = context.currentTime;

    /**
     * ArrayBufferReader wrapped around the audio input stream
     * provided with this RawAudioPlayer was created.
     *
     * @private
     * @type {ArrayBufferReader}
     */
    var reader = new ArrayBufferReader(stream);

    /**
     * The minimum size of an audio packet split by splitAudioPacket(), in
     * seconds. Audio packets smaller than this will not be split, nor will the
     * split result of a larger packet ever be smaller in size than this
     * minimum.
     *
     * @private
     * @constant
     * @type {Number}
     */
    var MIN_SPLIT_SIZE = 0.02;

    /**
     * The maximum amount of latency to allow between the buffered data stream
     * and the playback position, in seconds. Initially, this is set to
     * roughly one third of a second.
     *
     * @private
     * @type {Number}
     */
    var maxLatency = 0.3;

    /**
     * The type of typed array that will be used to represent each audio packet
     * internally. This will be either Int8Array or Int16Array, depending on
     * whether the raw audio format is 8-bit or 16-bit.
     *
     * @private
     * @constructor
     */
    var SampleArray = (format.bytesPerSample === 1) ? window.Int8Array : window.Int16Array;

    /**
     * The maximum absolute value of any sample within a raw audio packet
     * received by this audio player. This depends only on the size of each
     * sample, and will be 128 for 8-bit audio and 32768 for 16-bit audio.
     *
     * @private
     * @type {Number}
     */
    var maxSampleValue = (format.bytesPerSample === 1) ? 128 : 32768;

    /**
     * The queue of all pending audio packets, as an array of sample arrays.
     * Audio packets which are pending playback will be added to this queue for
     * further manipulation prior to scheduling via the Web Audio API. Once an
     * audio packet leaves this queue and is scheduled via the Web Audio API,
     * no further modifications can be made to that packet.
     *
     * @private
     * @type {SampleArray[]}
     */
    var packetQueue = [];

    /**
     * Given an array of audio packets, returns a single audio packet
     * containing the concatenation of those packets.
     *
     * @private
     * @param {SampleArray[]} packets
     *     The array of audio packets to concatenate.
     *
     * @returns {SampleArray}
     *     A single audio packet containing the concatenation of all given
     *     audio packets. If no packets are provided, this will be undefined.
     */
    var joinAudioPackets = function joinAudioPackets(packets) {

        // Do not bother joining if one or fewer packets are in the queue
        if (packets.length <= 1)
            return packets[0];

        // Determine total sample length of the entire queue
        var totalLength = 0;
        packets.forEach(function addPacketLengths(packet) {
            totalLength += packet.length;
        });

        // Append each packet within queue
        var offset = 0;
        var joined = new SampleArray(totalLength);
        packets.forEach(function appendPacket(packet) {
            joined.set(packet, offset);
            offset += packet.length;
        });

        return joined;

    };

    /**
     * Given a single packet of audio data, splits off an arbitrary length of
     * audio data from the beginning of that packet, returning the split result
     * as an array of two packets. The split location is determined through an
     * algorithm intended to minimize the liklihood of audible clicking between
     * packets. If no such split location is possible, an array containing only
     * the originally-provided audio packet is returned.
     *
     * @private
     * @param {SampleArray} data
     *     The audio packet to split.
     *
     * @returns {SampleArray[]}
     *     An array of audio packets containing the result of splitting the
     *     provided audio packet. If splitting is possible, this array will
     *     contain two packets. If splitting is not possible, this array will
     *     contain only the originally-provided packet.
     */
    var splitAudioPacket = function splitAudioPacket(data) {

        var minValue = Number.MAX_VALUE;
        var optimalSplitLength = data.length;

        // Calculate number of whole samples in the provided audio packet AND
        // in the minimum possible split packet
        var samples = Math.floor(data.length / format.channels);
        var minSplitSamples = Math.floor(format.rate * MIN_SPLIT_SIZE);

        // Calculate the beginning of the "end" of the audio packet
        var start = Math.max(
            format.channels * minSplitSamples,
            format.channels * (samples - minSplitSamples)
        );

        // For all samples at the end of the given packet, find a point where
        // the perceptible volume across all channels is lowest (and thus is
        // the optimal point to split)
        for (var offset = start; offset < data.length; offset += format.channels) {

            // Calculate the sum of all values across all channels (the result
            // will be proportional to the average volume of a sample)
            var totalValue = 0;
            for (var channel = 0; channel < format.channels; channel++) {
                totalValue += Math.abs(data[offset + channel]);
            }

            // If this is the smallest average value thus far, set the split
            // length such that the first packet ends with the current sample
            if (totalValue <= minValue) {
                optimalSplitLength = offset + format.channels;
                minValue = totalValue;
            }

        }

        // If packet is not split, return the supplied packet untouched
        if (optimalSplitLength === data.length)
            return [data];

        // Otherwise, split the packet into two new packets according to the
        // calculated optimal split length
        return [
            new SampleArray(data.buffer.slice(0, optimalSplitLength * format.bytesPerSample)),
            new SampleArray(data.buffer.slice(optimalSplitLength * format.bytesPerSample))
        ];

    };

    /**
     * Pushes the given packet of audio data onto the playback queue. Unlike
     * other private functions within RawAudioPlayer, the type of the
     * ArrayBuffer packet of audio data here need not be specific to the type
     * of audio (as with SampleArray). The ArrayBuffer type provided by a
     * ArrayBufferReader, for example, is sufficient. Any necessary
     * conversions will be performed automatically internally.
     *
     * @private
     * @param {ArrayBuffer} data
     *     A raw packet of audio data that should be pushed onto the audio
     *     playback queue.
     */
    var pushAudioPacket = function pushAudioPacket(data) {
        packetQueue.push(new SampleArray(data));
    };

    /**
     * Shifts off and returns a packet of audio data from the beginning of the
     * playback queue. The length of this audio packet is determined
     * dynamically according to the click-reduction algorithm implemented by
     * splitAudioPacket().
     *
     * @private
     * @returns {SampleArray}
     *     A packet of audio data pulled from the beginning of the playback
     *     queue.
     */
    var shiftAudioPacket = function shiftAudioPacket() {

        // Flatten data in packet queue
        var data = joinAudioPackets(packetQueue);
        if (!data)
            return null;

        // Pull an appropriate amount of data from the front of the queue
        packetQueue = splitAudioPacket(data);
        data = packetQueue.shift();

        return data;

    };

    /**
     * Converts the given audio packet into an AudioBuffer, ready for playback
     * by the Web Audio API. Unlike the raw audio packets received by this
     * audio player, AudioBuffers require floating point samples and are split
     * into isolated planes of channel-specific data.
     *
     * @private
     * @param {SampleArray} data
     *     The raw audio packet that should be converted into a Web Audio API
     *     AudioBuffer.
     *
     * @returns {AudioBuffer}
     *     A new Web Audio API AudioBuffer containing the provided audio data,
     *     converted to the format used by the Web Audio API.
     */
    var toAudioBuffer = function toAudioBuffer(data) {

        // Calculate total number of samples
        var samples = data.length / format.channels;

        // Determine exactly when packet CAN play
        var packetTime = context.currentTime;
        if (nextPacketTime < packetTime)
            nextPacketTime = packetTime;

        // Get audio buffer for specified format
        var audioBuffer = context.createBuffer(format.channels, samples, format.rate);

        // Convert each channel
        for (var channel = 0; channel < format.channels; channel++) {

            var audioData = audioBuffer.getChannelData(channel);

            // Fill audio buffer with data for channel
            var offset = channel;
            for (var i = 0; i < samples; i++) {
                audioData[i] = data[offset] / maxSampleValue;
                offset += format.channels;
            }

        }

        return audioBuffer;

    };

    // Defer playback of received audio packets slightly
    reader.ondata = function playReceivedAudio(data) {

        // Push received samples onto queue
        pushAudioPacket(new SampleArray(data));

        // Shift off an arbitrary packet of audio data from the queue (this may
        // be different in size from the packet just pushed)
        var packet = shiftAudioPacket();
        if (!packet)
            return;

        // Determine exactly when packet CAN play
        var packetTime = context.currentTime;
        if (nextPacketTime < packetTime)
            nextPacketTime = packetTime;

        // Set up buffer source
        var source = context.createBufferSource();
        source.connect(context.destination);

        // Use noteOn() instead of start() if necessary
        if (!source.start)
            source.start = source.noteOn;

        // Schedule packet
        source.buffer = toAudioBuffer(packet);
        source.start(nextPacketTime);

        // Update timeline by duration of scheduled packet
        nextPacketTime += packet.length / format.channels / format.rate;

    };

    /** @override */
    this.sync = function sync() {

        // Calculate elapsed time since last sync
        var now = context.currentTime;

        // Reschedule future playback time such that playback latency is
        // bounded within a reasonable latency threshold
        nextPacketTime = Math.min(nextPacketTime, now + maxLatency);

    };

}
RawAudioPlayer.prototype = new AudioPlayer();

/**
 * A description of the format of raw PCM audio received by a
 * RawAudioPlayer. This object describes the number of bytes per
 * sample, the number of channels, and the overall sample rate.
 *
 * @private
 * @constructor
 * @param {RawAudioPlayer._Format|Object} template
 *     The object whose properties should be copied into the corresponding
 *     properties of the new RawAudioPlayer._Format.
 */
RawAudioPlayer._Format = function _Format(template) {

    /**
     * The number of bytes in each sample of audio data. This value is
     * independent of the number of channels.
     *
     * @type {Number}
     */
    this.bytesPerSample = template.bytesPerSample;

    /**
     * The number of audio channels (ie: 1 for mono, 2 for stereo).
     *
     * @type {Number}
     */
    this.channels = template.channels;

    /**
     * The number of samples per second, per channel.
     *
     * @type {Number}
     */
    this.rate = template.rate;

};

/**
 * Parses the given mimetype, returning a new RawAudioPlayer._Format
 * which describes the type of raw audio data represented by that mimetype. If
 * the mimetype is not supported by RawAudioPlayer, null is returned.
 *
 * @private
 * @param {String} mimetype
 *     The audio mimetype to parse.
 *
 * @returns {RawAudioPlayer._Format}
 *     A new RawAudioPlayer._Format which describes the type of raw
 *     audio data represented by the given mimetype, or null if the given
 *     mimetype is not supported.
 */
RawAudioPlayer._Format.parse = function parseFormat(mimetype) {

    var bytesPerSample;

    // Rate is absolutely required - if null is still present later, the
    // mimetype must not be supported
    var rate = null;

    // Default for both "audio/L8" and "audio/L16" is one channel
    var channels = 1;

    // "audio/L8" has one byte per sample
    if (mimetype.substring(0, 9) === 'audio/L8;') {
        mimetype = mimetype.substring(9);
        bytesPerSample = 1;
    }

    // "audio/L16" has two bytes per sample
    else if (mimetype.substring(0, 10) === 'audio/L16;') {
        mimetype = mimetype.substring(10);
        bytesPerSample = 2;
    }

    // All other types are unsupported
    else
        return null;

    // Parse all parameters
    var parameters = mimetype.split(',');
    for (var i = 0; i < parameters.length; i++) {

        var parameter = parameters[i];

        // All parameters must have an equals sign separating name from value
        var equals = parameter.indexOf('=');
        if (equals === -1)
            return null;

        // Parse name and value from parameter string
        var name  = parameter.substring(0, equals);
        var value = parameter.substring(equals+1);

        // Handle each supported parameter
        switch (name) {

            // Number of audio channels
            case 'channels':
                channels = parseInt(value);
                break;

            // Sample rate
            case 'rate':
                rate = parseInt(value);
                break;

            // All other parameters are unsupported
            default:
                return null;

        }

    }
    // The rate parameter is required
    if (rate === null)
        return null;

    // Return parsed format details
    return new RawAudioPlayer._Format({
        bytesPerSample : bytesPerSample,
        channels       : channels,
        rate           : rate
    });

};

/**
 * Determines whether the given mimetype is supported by
 * RawAudioPlayer.
 *
 * @param {String} mimetype
 *     The mimetype to check.
 *
 * @returns {Boolean}
 *     true if the given mimetype is supported by RawAudioPlayer,
 *     false otherwise.
 */
RawAudioPlayer.isSupportedType = function isSupportedType(mimetype) {

    // No supported types if no Web Audio API
    if (!window.AudioContext && !window.webkitAudioContext)
        return false;

    return RawAudioPlayer._Format.parse(mimetype) !== null;

};

/**
 * Returns a list of all mimetypes supported by RawAudioPlayer. Only
 * the core mimetypes themselves will be listed. Any mimetype parameters, even
 * required ones, will not be included in the list. For example, "audio/L8" is
 * a raw audio mimetype that may be supported, but it is invalid without
 * additional parameters. Something like "audio/L8;rate=44100" would be valid,
 * however (see https://tools.ietf.org/html/rfc4856).
 *
 * @returns {String[]}
 *     A list of all mimetypes supported by RawAudioPlayer, excluding
 *     any parameters. If the necessary JavaScript APIs for playing raw audio
 *     are absent, this list will be empty.
 */
RawAudioPlayer.getSupportedTypes = function getSupportedTypes() {

    // No supported types if no Web Audio API
    if (!window.AudioContext && !window.webkitAudioContext)
        return [];

    // We support 8-bit and 16-bit raw PCM
    return [
        'audio/L8',
        'audio/L16'
    ];

};

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
/**
 * Abstract audio player which accepts, queues and plays back arbitrary audio
 * data. It is up to implementations of this class to provide some means of
 * handling a provided InputStream. Data received along the provided
 * stream is to be played back immediately.
 *
 * @constructor
 */
function AudioPlayer$1() {

    /**
     * Notifies this AudioPlayer that all audio up to the current
     * point in time has been given via the underlying stream, and that any
     * difference in time between queued audio data and the current time can be
     * considered latency.
     */
    this.sync = function sync() {
        // Default implementation - do nothing
    };

}
/**
 * Determines whether the given mimetype is supported by any built-in
 * implementation of AudioPlayer, and thus will be properly handled
 * by AudioPlayer.getInstance().
 *
 * @param {String} mimetype
 *     The mimetype to check.
 *
 * @returns {Boolean}
 *     true if the given mimetype is supported by any built-in
 *     AudioPlayer, false otherwise.
 */
AudioPlayer$1.isSupportedType = function isSupportedType(mimetype) {

    return RawAudioPlayer.isSupportedType(mimetype);

};

/**
 * Returns a list of all mimetypes supported by any built-in
 * AudioPlayer, in rough order of priority. Beware that only the core
 * mimetypes themselves will be listed. Any mimetype parameters, even required
 * ones, will not be included in the list. For example, "audio/L8" is a
 * supported raw audio mimetype that is supported, but it is invalid without
 * additional parameters. Something like "audio/L8;rate=44100" would be valid,
 * however (see https://tools.ietf.org/html/rfc4856).
 *
 * @returns {String[]}
 *     A list of all mimetypes supported by any built-in AudioPlayer,
 *     excluding any parameters.
 */
AudioPlayer$1.getSupportedTypes = function getSupportedTypes() {

    return RawAudioPlayer.getSupportedTypes();

};

/**
 * Returns an instance of AudioPlayer providing support for the given
 * audio format. If support for the given audio format is not available, null
 * is returned.
 *
 * @param {InputStream} stream
 *     The InputStream to read audio data from.
 *
 * @param {String} mimetype
 *     The mimetype of the audio data in the provided stream.
 *
 * @return {AudioPlayer}
 *     A AudioPlayer instance supporting the given mimetype and
 *     reading from the given stream, or null if support for the given mimetype
 *     is absent.
 */
AudioPlayer$1.getInstance = function getInstance(stream, mimetype) {

    // Use raw audio player if possible
    if (RawAudioPlayer.isSupportedType(mimetype))
        return new RawAudioPlayer(stream, mimetype);

    // No support for given mimetype
    return null;

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A reader which automatically handles the given input stream, assembling all
 * received blobs into a single blob by appending them to each other in order.
 * Note that this object will overwrite any installed event handlers on the
 * given InputStream.
 *
 * @constructor
 * @param {InputStream} stream The stream that data will be read
 *                                       from.
 * @param {String} mimetype The mimetype of the blob being built.
 */
function BlobReader(stream, mimetype) {

    /**
     * Reference to this InputStream.
     * @private
     */
    var guac_reader = this;

    /**
     * The length of this InputStream in bytes.
     * @private
     */
    var length = 0;

    // Get blob builder
    var blob_builder;
    if      (window.BlobBuilder)       blob_builder = new BlobBuilder();
    else if (window.WebKitBlobBuilder) blob_builder = new WebKitBlobBuilder();
    else if (window.MozBlobBuilder)    blob_builder = new MozBlobBuilder();
    else
        blob_builder = new (function() {

            var blobs = [];

            /** @ignore */
            this.append = function(data) {
                blobs.push(new Blob([data], {"type": mimetype}));
            };

            /** @ignore */
            this.getBlob = function() {
                return new Blob(blobs, {"type": mimetype});
            };

        })();

    // Append received blobs
    stream.onblob = function(data) {

        // Convert to ArrayBuffer
        var binary = window.atob(data);
        var arrayBuffer = new ArrayBuffer(binary.length);
        var bufferView = new Uint8Array(arrayBuffer);

        for (var i=0; i<binary.length; i++)
            bufferView[i] = binary.charCodeAt(i);

        blob_builder.append(arrayBuffer);
        length += arrayBuffer.byteLength;

        // Call handler, if present
        if (guac_reader.onprogress)
            guac_reader.onprogress(arrayBuffer.byteLength);

        // Send success response
        stream.sendAck("OK", 0x0000);

    };

    // Simply call onend when end received
    stream.onend = function() {
        if (guac_reader.onend)
            guac_reader.onend();
    };

    /**
     * Returns the current length of this InputStream, in bytes.
     * @return {Number} The current length of this InputStream.
     */
    this.getLength = function() {
        return length;
    };

    /**
     * Returns the contents of this BlobReader as a Blob.
     * @return {Blob} The contents of this BlobReader.
     */
    this.getBlob = function() {
        return blob_builder.getBlob();
    };

    /**
     * Fired once for every blob of data received.
     *
     * @event
     * @param {Number} length The number of bytes received.
     */
    this.onprogress = null;

    /**
     * Fired once this stream is finished and no further data will be written.
     * @event
     */
    this.onend = null;

}

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A Guacamole status. Each Guacamole status consists of a status code, defined
 * by the protocol, and an optional human-readable message, usually only
 * included for debugging convenience.
 *
 * @constructor
 * @param {Number} code
 *     The Guacamole status code, as defined by Status.Code.
 *
 * @param {String} [message]
 *     An optional human-readable message.
 */
function Status$1(code, message) {

    /**
     * Reference to this Status.
     * @private
     */
    var guac_status = this;

    /**
     * The Guacamole status code.
     * @see Status.Code
     * @type {Number}
     */
    this.code = code;

    /**
     * An arbitrary human-readable message associated with this status, if any.
     * The human-readable message is not required, and is generally provided
     * for debugging purposes only. For user feedback, it is better to translate
     * the Guacamole status code into a message.
     *
     * @type {String}
     */
    this.message = message;

    /**
     * Returns whether this status represents an error.
     * @returns {Boolean} true if this status represents an error, false
     *                    otherwise.
     */
    this.isError = function() {
        return guac_status.code < 0 || guac_status.code > 0x00FF;
    };

}
/**
 * Enumeration of all Guacamole status codes.
 */
Status$1.Code = {

    /**
     * The operation succeeded.
     *
     * @type {Number}
     */
    "SUCCESS": 0x0000,

    /**
     * The requested operation is unsupported.
     *
     * @type {Number}
     */
    "UNSUPPORTED": 0x0100,

    /**
     * The operation could not be performed due to an internal failure.
     *
     * @type {Number}
     */
    "SERVER_ERROR": 0x0200,

    /**
     * The operation could not be performed as the server is busy.
     *
     * @type {Number}
     */
    "SERVER_BUSY": 0x0201,

    /**
     * The operation could not be performed because the upstream server is not
     * responding.
     *
     * @type {Number}
     */
    "UPSTREAM_TIMEOUT": 0x0202,

    /**
     * The operation was unsuccessful due to an error or otherwise unexpected
     * condition of the upstream server.
     *
     * @type {Number}
     */
    "UPSTREAM_ERROR": 0x0203,

    /**
     * The operation could not be performed as the requested resource does not
     * exist.
     *
     * @type {Number}
     */
    "RESOURCE_NOT_FOUND": 0x0204,

    /**
     * The operation could not be performed as the requested resource is
     * already in use.
     *
     * @type {Number}
     */
    "RESOURCE_CONFLICT": 0x0205,

    /**
     * The operation could not be performed because bad parameters were given.
     *
     * @type {Number}
     */
    "CLIENT_BAD_REQUEST": 0x0300,

    /**
     * Permission was denied to perform the operation, as the user is not yet
     * authorized (not yet logged in, for example).
     *
     * @type {Number}
     */
    "CLIENT_UNAUTHORIZED": 0x0301,

    /**
     * Permission was denied to perform the operation, and this permission will
     * not be granted even if the user is authorized.
     *
     * @type {Number}
     */
    "CLIENT_FORBIDDEN": 0x0303,

    /**
     * The client took too long to respond.
     *
     * @type {Number}
     */
    "CLIENT_TIMEOUT": 0x0308,

    /**
     * The client sent too much data.
     *
     * @type {Number}
     */
    "CLIENT_OVERRUN": 0x030D,

    /**
     * The client sent data of an unsupported or unexpected type.
     *
     * @type {Number}
     */
    "CLIENT_BAD_TYPE": 0x030F,

    /**
     * The operation failed because the current client is already using too
     * many resources.
     *
     * @type {Number}
     */
    "CLIENT_TOO_MANY": 0x031D

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Core object providing abstract communication for Guacamole. This object
 * is a null implementation whose functions do nothing. Guacamole applications
 * should use {@link HTTPTunnel} instead, or implement their own tunnel based
 * on this one.
 *
 * @constructor
 * @see HTTPTunnel
 */
function Tunnel() {

    /**
     * Connect to the tunnel with the given optional data. This data is
     * typically used for authentication. The format of data accepted is
     * up to the tunnel implementation.
     *
     * @param {String} data The data to send to the tunnel when connecting.
     */
    this.connect = function(data) {};

    /**
     * Disconnect from the tunnel.
     */
    this.disconnect = function() {};

    /**
     * Send the given message through the tunnel to the service on the other
     * side. All messages are guaranteed to be received in the order sent.
     *
     * @param {...*} elements
     *     The elements of the message to send to the service on the other side
     *     of the tunnel.
     */
    this.sendMessage = function(elements) {};

    /**
     * The current state of this tunnel.
     *
     * @type {Number}
     */
    this.state = Tunnel.State.CONNECTING;

    /**
     * The maximum amount of time to wait for data to be received, in
     * milliseconds. If data is not received within this amount of time,
     * the tunnel is closed with an error. The default value is 15000.
     *
     * @type {Number}
     */
    this.receiveTimeout = 15000;

    /**
     * Fired whenever an error is encountered by the tunnel.
     *
     * @event
     * @param {Status} status A status object which describes the
     *                                  error.
     */
    this.onerror = null;

    /**
     * Fired whenever the state of the tunnel changes.
     *
     * @event
     * @param {Number} state The new state of the client.
     */
    this.onstatechange = null;

    /**
     * Fired once for every complete Guacamole instruction received, in order.
     *
     * @event
     * @param {String} opcode The Guacamole instruction opcode.
     * @param {Array} parameters The parameters provided for the instruction,
     *                           if any.
     */
    this.oninstruction = null;

}
/**
 * All possible tunnel states.
 */
Tunnel.State = {

    /**
     * A connection is in pending. It is not yet known whether connection was
     * successful.
     *
     * @type {Number}
     */
    "CONNECTING": 0,

    /**
     * Connection was successful, and data is being received.
     *
     * @type {Number}
     */
    "OPEN": 1,

    /**
     * The connection is closed. Connection may not have been successful, the
     * tunnel may have been explicitly closed by either side, or an error may
     * have occurred.
     *
     * @type {Number}
     */
    "CLOSED": 2

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Guacamole Tunnel which cycles between all specified tunnels until
 * no tunnels are left. Another tunnel is used if an error occurs but
 * no instructions have been received. If an instruction has been
 * received, or no tunnels remain, the error is passed directly out
 * through the onerror handler (if defined).
 *
 * @constructor
 * @augments Tunnel
 * @param {...*} tunnelChain
 *     The tunnels to use, in order of priority.
 */
function ChainedTunnel(tunnelChain) {

    /**
     * Reference to this chained tunnel.
     * @private
     */
    var chained_tunnel = this;

    /**
     * Data passed in via connect(), to be used for
     * wrapped calls to other tunnels' connect() functions.
     * @private
     */
    var connect_data;

    /**
     * Array of all tunnels passed to this ChainedTunnel through the
     * constructor arguments.
     * @private
     */
    var tunnels = [];

    /**
     * The tunnel committed via commit_tunnel(), if any, or null if no tunnel
     * has yet been committed.
     *
     * @private
     * @type {Tunnel}
     */
    var committedTunnel = null;

    // Load all tunnels into array
    for (var i=0; i<arguments.length; i++)
        tunnels.push(arguments[i]);

    /**
     * Sets the current tunnel.
     *
     * @private
     * @param {Tunnel} tunnel The tunnel to set as the current tunnel.
     */
    function attach(tunnel) {

        // Set own functions to tunnel's functions
        chained_tunnel.disconnect  = tunnel.disconnect;
        chained_tunnel.sendMessage = tunnel.sendMessage;

        /**
         * Fails the currently-attached tunnel, attaching a new tunnel if
         * possible.
         *
         * @private
         * @param {Status} [status]
         *     An object representing the failure that occured in the
         *     currently-attached tunnel, if known.
         *
         * @return {Tunnel}
         *     The next tunnel, or null if there are no more tunnels to try or
         *     if no more tunnels should be tried.
         */
        var failTunnel = function failTunnel(status) {

            // Do not attempt to continue using next tunnel on server timeout
            if (status && status.code === Status.Code.UPSTREAM_TIMEOUT) {
                tunnels = [];
                return null;
            }

            // Get next tunnel
            var next_tunnel = tunnels.shift();

            // If there IS a next tunnel, try using it.
            if (next_tunnel) {
                tunnel.onerror = null;
                tunnel.oninstruction = null;
                tunnel.onstatechange = null;
                attach(next_tunnel);
            }

            return next_tunnel;

        };

        /**
         * Use the current tunnel from this point forward. Do not try any more
         * tunnels, even if the current tunnel fails.
         *
         * @private
         */
        function commit_tunnel() {
            tunnel.onstatechange = chained_tunnel.onstatechange;
            tunnel.oninstruction = chained_tunnel.oninstruction;
            tunnel.onerror = chained_tunnel.onerror;
            committedTunnel = tunnel;
        }

        // Wrap own onstatechange within current tunnel
        tunnel.onstatechange = function(state) {

            switch (state) {

                // If open, use this tunnel from this point forward.
                case Tunnel.State.OPEN:
                    commit_tunnel();
                    if (chained_tunnel.onstatechange)
                        chained_tunnel.onstatechange(state);
                    break;

                // If closed, mark failure, attempt next tunnel
                case Tunnel.State.CLOSED:
                    if (!failTunnel() && chained_tunnel.onstatechange)
                        chained_tunnel.onstatechange(state);
                    break;

            }

        };

        // Wrap own oninstruction within current tunnel
        tunnel.oninstruction = function(opcode, elements) {

            // Accept current tunnel
            commit_tunnel();

            // Invoke handler
            if (chained_tunnel.oninstruction)
                chained_tunnel.oninstruction(opcode, elements);

        };

        // Attach next tunnel on error
        tunnel.onerror = function(status) {

            // Mark failure, attempt next tunnel
            if (!failTunnel(status) && chained_tunnel.onerror)
                chained_tunnel.onerror(status);

        };

        // Attempt connection
        tunnel.connect(connect_data);

    }

    this.connect = function(data) {

        // Remember connect data
        connect_data = data;

        // Get committed tunnel if exists or the first tunnel on the list
        var next_tunnel = committedTunnel ? committedTunnel : tunnels.shift();

        // Attach first tunnel
        if (next_tunnel)
            attach(next_tunnel);

        // If there IS no first tunnel, error
        else if (chained_tunnel.onerror)
            chained_tunnel.onerror(Status.Code.SERVER_ERROR, "No tunnels to try.");

    };

}
ChainedTunnel.prototype = new Tunnel();

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Abstract ordered drawing surface. Each Layer contains a canvas element and
 * provides simple drawing instructions for drawing to that canvas element,
 * however unlike the canvas element itself, drawing operations on a Layer are
 * guaranteed to run in order, even if such an operation must wait for an image
 * to load before completing.
 *
 * @constructor
 *
 * @param {Number} width The width of the Layer, in pixels. The canvas element
 *                       backing this Layer will be given this width.
 *
 * @param {Number} height The height of the Layer, in pixels. The canvas element
 *                        backing this Layer will be given this height.
 */
function Layer$1(width, height) {

    /**
     * Reference to this Layer.
     * @private
     */
    var layer = this;

    /**
     * The canvas element backing this Layer.
     * @private
     */
    var canvas = document.createElement("canvas");

    /**
     * The 2D display context of the canvas element backing this Layer.
     * @private
     */
    var context = canvas.getContext("2d");
    context.save();

    /**
     * Whether a new path should be started with the next path drawing
     * operations.
     * @private
     */
    var pathClosed = true;

    /**
     * The number of states on the state stack.
     *
     * Note that there will ALWAYS be one element on the stack, but that
     * element is not exposed. It is only used to reset the layer to its
     * initial state.
     *
     * @private
     */
    var stackSize = 0;

    /**
     * Map of all Guacamole channel masks to HTML5 canvas composite operation
     * names. Not all channel mask combinations are currently implemented.
     * @private
     */
    var compositeOperation = {
     /* 0x0 NOT IMPLEMENTED */
        0x1: "destination-in",
        0x2: "destination-out",
     /* 0x3 NOT IMPLEMENTED */
        0x4: "source-in",
     /* 0x5 NOT IMPLEMENTED */
        0x6: "source-atop",
     /* 0x7 NOT IMPLEMENTED */
        0x8: "source-out",
        0x9: "destination-atop",
        0xA: "xor",
        0xB: "destination-over",
        0xC: "copy",
     /* 0xD NOT IMPLEMENTED */
        0xE: "source-over",
        0xF: "lighter"
    };

    /**
     * Resizes the canvas element backing this Layer without testing the
     * new size. This function should only be used internally.
     *
     * @private
     * @param {Number} newWidth The new width to assign to this Layer.
     * @param {Number} newHeight The new height to assign to this Layer.
     */
    function resize(newWidth, newHeight) {

        // Only preserve old data if width/height are both non-zero
        var oldData = null;
        if (layer.width !== 0 && layer.height !== 0) {

            // Create canvas and context for holding old data
            oldData = document.createElement("canvas");
            oldData.width = layer.width;
            oldData.height = layer.height;

            var oldDataContext = oldData.getContext("2d");

            // Copy image data from current
            oldDataContext.drawImage(canvas,
                    0, 0, layer.width, layer.height,
                    0, 0, layer.width, layer.height);

        }

        // Preserve composite operation
        var oldCompositeOperation = context.globalCompositeOperation;

        // Resize canvas
        canvas.width = newWidth;
        canvas.height = newHeight;

        // Redraw old data, if any
        if (oldData)
                context.drawImage(oldData,
                    0, 0, layer.width, layer.height,
                    0, 0, layer.width, layer.height);

        // Restore composite operation
        context.globalCompositeOperation = oldCompositeOperation;

        layer.width = newWidth;
        layer.height = newHeight;

        // Acknowledge reset of stack (happens on resize of canvas)
        stackSize = 0;
        context.save();

    }

    /**
     * Given the X and Y coordinates of the upper-left corner of a rectangle
     * and the rectangle's width and height, resize the backing canvas element
     * as necessary to ensure that the rectangle fits within the canvas
     * element's coordinate space. This function will only make the canvas
     * larger. If the rectangle already fits within the canvas element's
     * coordinate space, the canvas is left unchanged.
     *
     * @private
     * @param {Number} x The X coordinate of the upper-left corner of the
     *                   rectangle to fit.
     * @param {Number} y The Y coordinate of the upper-left corner of the
     *                   rectangle to fit.
     * @param {Number} w The width of the the rectangle to fit.
     * @param {Number} h The height of the the rectangle to fit.
     */
    function fitRect(x, y, w, h) {

        // Calculate bounds
        var opBoundX = w + x;
        var opBoundY = h + y;

        // Determine max width
        var resizeWidth;
        if (opBoundX > layer.width)
            resizeWidth = opBoundX;
        else
            resizeWidth = layer.width;

        // Determine max height
        var resizeHeight;
        if (opBoundY > layer.height)
            resizeHeight = opBoundY;
        else
            resizeHeight = layer.height;

        // Resize if necessary
        layer.resize(resizeWidth, resizeHeight);

    }

    /**
     * Set to true if this Layer should resize itself to accomodate the
     * dimensions of any drawing operation, and false (the default) otherwise.
     *
     * Note that setting this property takes effect immediately, and thus may
     * take effect on operations that were started in the past but have not
     * yet completed. If you wish the setting of this flag to only modify
     * future operations, you will need to make the setting of this flag an
     * operation with sync().
     *
     * @example
     * // Set autosize to true for all future operations
     * layer.sync(function() {
     *     layer.autosize = true;
     * });
     *
     * @type {Boolean}
     * @default false
     */
    this.autosize = false;

    /**
     * The current width of this layer.
     * @type {Number}
     */
    this.width = width;

    /**
     * The current height of this layer.
     * @type {Number}
     */
    this.height = height;

    /**
     * Returns the canvas element backing this Layer.
     * @returns {Element} The canvas element backing this Layer.
     */
    this.getCanvas = function() {
        return canvas;
    };

    /**
     * Changes the size of this Layer to the given width and height. Resizing
     * is only attempted if the new size provided is actually different from
     * the current size.
     *
     * @param {Number} newWidth The new width to assign to this Layer.
     * @param {Number} newHeight The new height to assign to this Layer.
     */
    this.resize = function(newWidth, newHeight) {
        if (newWidth !== layer.width || newHeight !== layer.height)
            resize(newWidth, newHeight);
    };

    /**
     * Draws the specified image at the given coordinates. The image specified
     * must already be loaded.
     *
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     * @param {Image} image The image to draw. Note that this is an Image
     *                      object - not a URL.
     */
    this.drawImage = function(x, y, image) {
        if (layer.autosize) fitRect(x, y, image.width, image.height);
        context.drawImage(image, x, y);
    };

    /**
     * Transfer a rectangle of image data from one Layer to this Layer using the
     * specified transfer function.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     * @param {Function} transferFunction The transfer function to use to
     *                                    transfer data from source to
     *                                    destination.
     */
    this.transfer = function(srcLayer, srcx, srcy, srcw, srch, x, y, transferFunction) {

        var srcCanvas = srcLayer.getCanvas();

        // If entire rectangle outside source canvas, stop
        if (srcx >= srcCanvas.width || srcy >= srcCanvas.height) return;

        // Otherwise, clip rectangle to area
        if (srcx + srcw > srcCanvas.width)
            srcw = srcCanvas.width - srcx;

        if (srcy + srch > srcCanvas.height)
            srch = srcCanvas.height - srcy;

        // Stop if nothing to draw.
        if (srcw === 0 || srch === 0) return;

        if (layer.autosize) fitRect(x, y, srcw, srch);

        // Get image data from src and dst
        var src = srcLayer.getCanvas().getContext("2d").getImageData(srcx, srcy, srcw, srch);
        var dst = context.getImageData(x , y, srcw, srch);

        // Apply transfer for each pixel
        for (var i=0; i<srcw*srch*4; i+=4) {

            // Get source pixel environment
            var src_pixel = new Layer.Pixel(
                src.data[i],
                src.data[i+1],
                src.data[i+2],
                src.data[i+3]
            );

            // Get destination pixel environment
            var dst_pixel = new Layer.Pixel(
                dst.data[i],
                dst.data[i+1],
                dst.data[i+2],
                dst.data[i+3]
            );

            // Apply transfer function
            transferFunction(src_pixel, dst_pixel);

            // Save pixel data
            dst.data[i  ] = dst_pixel.red;
            dst.data[i+1] = dst_pixel.green;
            dst.data[i+2] = dst_pixel.blue;
            dst.data[i+3] = dst_pixel.alpha;

        }

        // Draw image data
        context.putImageData(dst, x, y);

    };

    /**
     * Put a rectangle of image data from one Layer to this Layer directly
     * without performing any alpha blending. Simply copy the data.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     */
    this.put = function(srcLayer, srcx, srcy, srcw, srch, x, y) {

        var srcCanvas = srcLayer.getCanvas();

        // If entire rectangle outside source canvas, stop
        if (srcx >= srcCanvas.width || srcy >= srcCanvas.height) return;

        // Otherwise, clip rectangle to area
        if (srcx + srcw > srcCanvas.width)
            srcw = srcCanvas.width - srcx;

        if (srcy + srch > srcCanvas.height)
            srch = srcCanvas.height - srcy;

        // Stop if nothing to draw.
        if (srcw === 0 || srch === 0) return;

        if (layer.autosize) fitRect(x, y, srcw, srch);

        // Get image data from src and dst
        var src = srcLayer.getCanvas().getContext("2d").getImageData(srcx, srcy, srcw, srch);
        context.putImageData(src, x, y);

    };

    /**
     * Copy a rectangle of image data from one Layer to this Layer. This
     * operation will copy exactly the image data that will be drawn once all
     * operations of the source Layer that were pending at the time this
     * function was called are complete. This operation will not alter the
     * size of the source Layer even if its autosize property is set to true.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     */
    this.copy = function(srcLayer, srcx, srcy, srcw, srch, x, y) {

        var srcCanvas = srcLayer.getCanvas();

        // If entire rectangle outside source canvas, stop
        if (srcx >= srcCanvas.width || srcy >= srcCanvas.height) return;

        // Otherwise, clip rectangle to area
        if (srcx + srcw > srcCanvas.width)
            srcw = srcCanvas.width - srcx;

        if (srcy + srch > srcCanvas.height)
            srch = srcCanvas.height - srcy;

        // Stop if nothing to draw.
        if (srcw === 0 || srch === 0) return;

        if (layer.autosize) fitRect(x, y, srcw, srch);
        context.drawImage(srcCanvas, srcx, srcy, srcw, srch, x, y, srcw, srch);

    };

    /**
     * Starts a new path at the specified point.
     *
     * @param {Number} x The X coordinate of the point to draw.
     * @param {Number} y The Y coordinate of the point to draw.
     */
    this.moveTo = function(x, y) {

        // Start a new path if current path is closed
        if (pathClosed) {
            context.beginPath();
            pathClosed = false;
        }

        if (layer.autosize) fitRect(x, y, 0, 0);
        context.moveTo(x, y);

    };

    /**
     * Add the specified line to the current path.
     *
     * @param {Number} x The X coordinate of the endpoint of the line to draw.
     * @param {Number} y The Y coordinate of the endpoint of the line to draw.
     */
    this.lineTo = function(x, y) {

        // Start a new path if current path is closed
        if (pathClosed) {
            context.beginPath();
            pathClosed = false;
        }

        if (layer.autosize) fitRect(x, y, 0, 0);
        context.lineTo(x, y);

    };

    /**
     * Add the specified arc to the current path.
     *
     * @param {Number} x The X coordinate of the center of the circle which
     *                   will contain the arc.
     * @param {Number} y The Y coordinate of the center of the circle which
     *                   will contain the arc.
     * @param {Number} radius The radius of the circle.
     * @param {Number} startAngle The starting angle of the arc, in radians.
     * @param {Number} endAngle The ending angle of the arc, in radians.
     * @param {Boolean} negative Whether the arc should be drawn in order of
     *                           decreasing angle.
     */
    this.arc = function(x, y, radius, startAngle, endAngle, negative) {

        // Start a new path if current path is closed
        if (pathClosed) {
            context.beginPath();
            pathClosed = false;
        }

        if (layer.autosize) fitRect(x, y, 0, 0);
        context.arc(x, y, radius, startAngle, endAngle, negative);

    };

    /**
     * Starts a new path at the specified point.
     *
     * @param {Number} cp1x The X coordinate of the first control point.
     * @param {Number} cp1y The Y coordinate of the first control point.
     * @param {Number} cp2x The X coordinate of the second control point.
     * @param {Number} cp2y The Y coordinate of the second control point.
     * @param {Number} x The X coordinate of the endpoint of the curve.
     * @param {Number} y The Y coordinate of the endpoint of the curve.
     */
    this.curveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {

        // Start a new path if current path is closed
        if (pathClosed) {
            context.beginPath();
            pathClosed = false;
        }

        if (layer.autosize) fitRect(x, y, 0, 0);
        context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);

    };

    /**
     * Closes the current path by connecting the end point with the start
     * point (if any) with a straight line.
     */
    this.close = function() {
        context.closePath();
        pathClosed = true;
    };

    /**
     * Add the specified rectangle to the current path.
     *
     * @param {Number} x The X coordinate of the upper-left corner of the
     *                   rectangle to draw.
     * @param {Number} y The Y coordinate of the upper-left corner of the
     *                   rectangle to draw.
     * @param {Number} w The width of the rectangle to draw.
     * @param {Number} h The height of the rectangle to draw.
     */
    this.rect = function(x, y, w, h) {

        // Start a new path if current path is closed
        if (pathClosed) {
            context.beginPath();
            pathClosed = false;
        }

        if (layer.autosize) fitRect(x, y, w, h);
        context.rect(x, y, w, h);

    };

    /**
     * Clip all future drawing operations by the current path. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as fillColor()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     */
    this.clip = function() {

        // Set new clipping region
        context.clip();

        // Path now implicitly closed
        pathClosed = true;

    };

    /**
     * Stroke the current path with the specified color. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {String} cap The line cap style. Can be "round", "square",
     *                     or "butt".
     * @param {String} join The line join style. Can be "round", "bevel",
     *                      or "miter".
     * @param {Number} thickness The line thickness in pixels.
     * @param {Number} r The red component of the color to fill.
     * @param {Number} g The green component of the color to fill.
     * @param {Number} b The blue component of the color to fill.
     * @param {Number} a The alpha component of the color to fill.
     */
    this.strokeColor = function(cap, join, thickness, r, g, b, a) {

        // Stroke with color
        context.lineCap = cap;
        context.lineJoin = join;
        context.lineWidth = thickness;
        context.strokeStyle = "rgba(" + r + "," + g + "," + b + "," + a/255.0 + ")";
        context.stroke();

        // Path now implicitly closed
        pathClosed = true;

    };

    /**
     * Fills the current path with the specified color. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Number} r The red component of the color to fill.
     * @param {Number} g The green component of the color to fill.
     * @param {Number} b The blue component of the color to fill.
     * @param {Number} a The alpha component of the color to fill.
     */
    this.fillColor = function(r, g, b, a) {

        // Fill with color
        context.fillStyle = "rgba(" + r + "," + g + "," + b + "," + a/255.0 + ")";
        context.fill();

        // Path now implicitly closed
        pathClosed = true;

    };

    /**
     * Stroke the current path with the image within the specified layer. The
     * image data will be tiled infinitely within the stroke. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {String} cap The line cap style. Can be "round", "square",
     *                     or "butt".
     * @param {String} join The line join style. Can be "round", "bevel",
     *                      or "miter".
     * @param {Number} thickness The line thickness in pixels.
     * @param {Layer} srcLayer The layer to use as a repeating pattern
     *                                   within the stroke.
     */
    this.strokeLayer = function(cap, join, thickness, srcLayer) {

        // Stroke with image data
        context.lineCap = cap;
        context.lineJoin = join;
        context.lineWidth = thickness;
        context.strokeStyle = context.createPattern(
            srcLayer.getCanvas(),
            "repeat"
        );
        context.stroke();

        // Path now implicitly closed
        pathClosed = true;

    };

    /**
     * Fills the current path with the image within the specified layer. The
     * image data will be tiled infinitely within the stroke. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} srcLayer The layer to use as a repeating pattern
     *                                   within the fill.
     */
    this.fillLayer = function(srcLayer) {

        // Fill with image data
        context.fillStyle = context.createPattern(
            srcLayer.getCanvas(),
            "repeat"
        );
        context.fill();

        // Path now implicitly closed
        pathClosed = true;

    };

    /**
     * Push current layer state onto stack.
     */
    this.push = function() {

        // Save current state onto stack
        context.save();
        stackSize++;

    };

    /**
     * Pop layer state off stack.
     */
    this.pop = function() {

        // Restore current state from stack
        if (stackSize > 0) {
            context.restore();
            stackSize--;
        }

    };

    /**
     * Reset the layer, clearing the stack, the current path, and any transform
     * matrix.
     */
    this.reset = function() {

        // Clear stack
        while (stackSize > 0) {
            context.restore();
            stackSize--;
        }

        // Restore to initial state
        context.restore();
        context.save();

        // Clear path
        context.beginPath();
        pathClosed = false;

    };

    /**
     * Sets the given affine transform (defined with six values from the
     * transform's matrix).
     *
     * @param {Number} a The first value in the affine transform's matrix.
     * @param {Number} b The second value in the affine transform's matrix.
     * @param {Number} c The third value in the affine transform's matrix.
     * @param {Number} d The fourth value in the affine transform's matrix.
     * @param {Number} e The fifth value in the affine transform's matrix.
     * @param {Number} f The sixth value in the affine transform's matrix.
     */
    this.setTransform = function(a, b, c, d, e, f) {
        context.setTransform(
            a, b, c,
            d, e, f
          /*0, 0, 1*/
        );
    };

    /**
     * Applies the given affine transform (defined with six values from the
     * transform's matrix).
     *
     * @param {Number} a The first value in the affine transform's matrix.
     * @param {Number} b The second value in the affine transform's matrix.
     * @param {Number} c The third value in the affine transform's matrix.
     * @param {Number} d The fourth value in the affine transform's matrix.
     * @param {Number} e The fifth value in the affine transform's matrix.
     * @param {Number} f The sixth value in the affine transform's matrix.
     */
    this.transform = function(a, b, c, d, e, f) {
        context.transform(
            a, b, c,
            d, e, f
          /*0, 0, 1*/
        );
    };

    /**
     * Sets the channel mask for future operations on this Layer.
     *
     * The channel mask is a Guacamole-specific compositing operation identifier
     * with a single bit representing each of four channels (in order): source
     * image where destination transparent, source where destination opaque,
     * destination where source transparent, and destination where source
     * opaque.
     *
     * @param {Number} mask The channel mask for future operations on this
     *                      Layer.
     */
    this.setChannelMask = function(mask) {
        context.globalCompositeOperation = compositeOperation[mask];
    };

    /**
     * Sets the miter limit for stroke operations using the miter join. This
     * limit is the maximum ratio of the size of the miter join to the stroke
     * width. If this ratio is exceeded, the miter will not be drawn for that
     * joint of the path.
     *
     * @param {Number} limit The miter limit for stroke operations using the
     *                       miter join.
     */
    this.setMiterLimit = function(limit) {
        context.miterLimit = limit;
    };

    // Initialize canvas dimensions
    canvas.width = width;
    canvas.height = height;

    // Explicitly render canvas below other elements in the layer (such as
    // child layers). Chrome and others may fail to render layers properly
    // without this.
    canvas.style.zIndex = -1;

}
/**
 * Channel mask for the composite operation "rout".
 */
Layer.ROUT  = 0x2;

/**
 * Channel mask for the composite operation "atop".
 */
Layer.ATOP  = 0x6;

/**
 * Channel mask for the composite operation "xor".
 */
Layer.XOR   = 0xA;

/**
 * Channel mask for the composite operation "rover".
 */
Layer.ROVER = 0xB;

/**
 * Channel mask for the composite operation "over".
 */
Layer.OVER  = 0xE;

/**
 * Channel mask for the composite operation "plus".
 */
Layer.PLUS  = 0xF;

/**
 * Channel mask for the composite operation "rin".
 * Beware that WebKit-based browsers may leave the contents of the destionation
 * layer where the source layer is transparent, despite the definition of this
 * operation.
 */
Layer.RIN   = 0x1;

/**
 * Channel mask for the composite operation "in".
 * Beware that WebKit-based browsers may leave the contents of the destionation
 * layer where the source layer is transparent, despite the definition of this
 * operation.
 */
Layer.IN    = 0x4;

/**
 * Channel mask for the composite operation "out".
 * Beware that WebKit-based browsers may leave the contents of the destionation
 * layer where the source layer is transparent, despite the definition of this
 * operation.
 */
Layer.OUT   = 0x8;

/**
 * Channel mask for the composite operation "ratop".
 * Beware that WebKit-based browsers may leave the contents of the destionation
 * layer where the source layer is transparent, despite the definition of this
 * operation.
 */
Layer.RATOP = 0x9;

/**
 * Channel mask for the composite operation "src".
 * Beware that WebKit-based browsers may leave the contents of the destionation
 * layer where the source layer is transparent, despite the definition of this
 * operation.
 */
Layer.SRC   = 0xC;

/**
 * Represents a single pixel of image data. All components have a minimum value
 * of 0 and a maximum value of 255.
 *
 * @constructor
 *
 * @param {Number} r The red component of this pixel.
 * @param {Number} g The green component of this pixel.
 * @param {Number} b The blue component of this pixel.
 * @param {Number} a The alpha component of this pixel.
 */
Layer.Pixel = function(r, g, b, a) {

    /**
     * The red component of this pixel, where 0 is the minimum value,
     * and 255 is the maximum.
     */
    this.red   = r;

    /**
     * The green component of this pixel, where 0 is the minimum value,
     * and 255 is the maximum.
     */
    this.green = g;

    /**
     * The blue component of this pixel, where 0 is the minimum value,
     * and 255 is the maximum.
     */
    this.blue  = b;

    /**
     * The alpha component of this pixel, where 0 is the minimum value,
     * and 255 is the maximum.
     */
    this.alpha = a;

};

/*
 * Copyright (C) 2014 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * The Guacamole display. The display does not deal with the Guacamole
 * protocol, and instead implements a set of graphical operations which
 * embody the set of operations present in the protocol. The order operations
 * are executed is guaranteed to be in the same order as their corresponding
 * functions are called.
 *
 * @constructor
 */
function Display$1() {

    /**
     * Reference to this Display.
     * @private
     */
    var guac_display = this;

    var displayWidth = 0;
    var displayHeight = 0;
    var displayScale = 1;

    // Create display
    var display = document.createElement("div");
    display.style.position = "relative";
    display.style.width = displayWidth + "px";
    display.style.height = displayHeight + "px";

    // Ensure transformations on display originate at 0,0
    display.style.transformOrigin =
    display.style.webkitTransformOrigin =
    display.style.MozTransformOrigin =
    display.style.OTransformOrigin =
    display.style.msTransformOrigin =
        "0 0";

    // Create default layer
    var default_layer = new Display.VisibleLayer(displayWidth, displayHeight);

    // Create cursor layer
    var cursor = new Display.VisibleLayer(0, 0);
    cursor.setChannelMask(Layer$1.SRC);

    // Add default layer and cursor to display
    display.appendChild(default_layer.getElement());
    display.appendChild(cursor.getElement());

    // Create bounding div
    var bounds = document.createElement("div");
    bounds.style.position = "relative";
    bounds.style.width = (displayWidth*displayScale) + "px";
    bounds.style.height = (displayHeight*displayScale) + "px";

    // Add display to bounds
    bounds.appendChild(display);

    /**
     * The X coordinate of the hotspot of the mouse cursor. The hotspot is
     * the relative location within the image of the mouse cursor at which
     * each click occurs.
     *
     * @type {Number}
     */
    this.cursorHotspotX = 0;

    /**
     * The Y coordinate of the hotspot of the mouse cursor. The hotspot is
     * the relative location within the image of the mouse cursor at which
     * each click occurs.
     *
     * @type {Number}
     */
    this.cursorHotspotY = 0;

    /**
     * The current X coordinate of the local mouse cursor. This is not
     * necessarily the location of the actual mouse - it refers only to
     * the location of the cursor image within the Guacamole display, as
     * last set by moveCursor().
     *
     * @type {Number}
     */
    this.cursorX = 0;

    /**
     * The current X coordinate of the local mouse cursor. This is not
     * necessarily the location of the actual mouse - it refers only to
     * the location of the cursor image within the Guacamole display, as
     * last set by moveCursor().
     *
     * @type {Number}
     */
    this.cursorY = 0;

    /**
     * Fired when the default layer (and thus the entire Guacamole display)
     * is resized.
     *
     * @event
     * @param {Number} width The new width of the Guacamole display.
     * @param {Number} height The new height of the Guacamole display.
     */
    this.onresize = null;

    /**
     * Fired whenever the local cursor image is changed. This can be used to
     * implement special handling of the client-side cursor, or to override
     * the default use of a software cursor layer.
     *
     * @event
     * @param {HTMLCanvasElement} canvas The cursor image.
     * @param {Number} x The X-coordinate of the cursor hotspot.
     * @param {Number} y The Y-coordinate of the cursor hotspot.
     */
    this.oncursor = null;

    /**
     * The queue of all pending Tasks. Tasks will be run in order, with new
     * tasks added at the end of the queue and old tasks removed from the
     * front of the queue (FIFO). These tasks will eventually be grouped
     * into a Frame.
     * @private
     * @type {Task[]}
     */
    var tasks = [];

    /**
     * The queue of all frames. Each frame is a pairing of an array of tasks
     * and a callback which must be called when the frame is rendered.
     * @private
     * @type {Frame[]}
     */
    var frames = [];

    /**
     * Flushes all pending frames.
     * @private
     */
    function __flush_frames() {

        var rendered_frames = 0;

        // Draw all pending frames, if ready
        while (rendered_frames < frames.length) {

            var frame = frames[rendered_frames];
            if (!frame.isReady())
                break;

            frame.flush();
            rendered_frames++;

        }

        // Remove rendered frames from array
        frames.splice(0, rendered_frames);

    }

    /**
     * An ordered list of tasks which must be executed atomically. Once
     * executed, an associated (and optional) callback will be called.
     *
     * @private
     * @constructor
     * @param {function} callback The function to call when this frame is
     *                            rendered.
     * @param {Task[]} tasks The set of tasks which must be executed to render
     *                       this frame.
     */
    function Frame(callback, tasks) {

        /**
         * Returns whether this frame is ready to be rendered. This function
         * returns true if and only if ALL underlying tasks are unblocked.
         *
         * @returns {Boolean} true if all underlying tasks are unblocked,
         *                    false otherwise.
         */
        this.isReady = function() {

            // Search for blocked tasks
            for (var i=0; i < tasks.length; i++) {
                if (tasks[i].blocked)
                    return false;
            }

            // If no blocked tasks, the frame is ready
            return true;

        };

        /**
         * Renders this frame, calling the associated callback, if any, after
         * the frame is complete. This function MUST only be called when no
         * blocked tasks exist. Calling this function with blocked tasks
         * will result in undefined behavior.
         */
        this.flush = function() {

            // Draw all pending tasks.
            for (var i=0; i < tasks.length; i++)
                tasks[i].execute();

            // Call callback
            if (callback) callback();

        };

    }

    /**
     * A container for an task handler. Each operation which must be ordered
     * is associated with a Task that goes into a task queue. Tasks in this
     * queue are executed in order once their handlers are set, while Tasks
     * without handlers block themselves and any following Tasks from running.
     *
     * @constructor
     * @private
     * @param {function} taskHandler The function to call when this task
     *                               runs, if any.
     * @param {boolean} blocked Whether this task should start blocked.
     */
    function Task(taskHandler, blocked) {

        var task = this;

        /**
         * Whether this Task is blocked.
         *
         * @type {boolean}
         */
        this.blocked = blocked;

        /**
         * Unblocks this Task, allowing it to run.
         */
        this.unblock = function() {
            if (task.blocked) {
                task.blocked = false;
                __flush_frames();
            }
        };

        /**
         * Calls the handler associated with this task IMMEDIATELY. This
         * function does not track whether this task is marked as blocked.
         * Enforcing the blocked status of tasks is up to the caller.
         */
        this.execute = function() {
            if (taskHandler) taskHandler();
        };

    }

    /**
     * Schedules a task for future execution. The given handler will execute
     * immediately after all previous tasks upon frame flush, unless this
     * task is blocked. If any tasks is blocked, the entire frame will not
     * render (and no tasks within will execute) until all tasks are unblocked.
     *
     * @private
     * @param {function} handler The function to call when possible, if any.
     * @param {boolean} blocked Whether the task should start blocked.
     * @returns {Task} The Task created and added to the queue for future
     *                 running.
     */
    function scheduleTask(handler, blocked) {
        var task = new Task(handler, blocked);
        tasks.push(task);
        return task;
    }

    /**
     * Returns the element which contains the Guacamole display.
     *
     * @return {Element} The element containing the Guacamole display.
     */
    this.getElement = function() {
        return bounds;
    };

    /**
     * Returns the width of this display.
     *
     * @return {Number} The width of this display;
     */
    this.getWidth = function() {
        return displayWidth;
    };

    /**
     * Returns the height of this display.
     *
     * @return {Number} The height of this display;
     */
    this.getHeight = function() {
        return displayHeight;
    };

    /**
     * Returns the default layer of this display. Each Guacamole display always
     * has at least one layer. Other layers can optionally be created within
     * this layer, but the default layer cannot be removed and is the absolute
     * ancestor of all other layers.
     *
     * @return {Display.VisibleLayer} The default layer.
     */
    this.getDefaultLayer = function() {
        return default_layer;
    };

    /**
     * Returns the cursor layer of this display. Each Guacamole display contains
     * a layer for the image of the mouse cursor. This layer is a special case
     * and exists above all other layers, similar to the hardware mouse cursor.
     *
     * @return {Display.VisibleLayer} The cursor layer.
     */
    this.getCursorLayer = function() {
        return cursor;
    };

    /**
     * Creates a new layer. The new layer will be a direct child of the default
     * layer, but can be moved to be a child of any other layer. Layers returned
     * by this function are visible.
     *
     * @return {Display.VisibleLayer} The newly-created layer.
     */
    this.createLayer = function() {
        var layer = new Display.VisibleLayer(displayWidth, displayHeight);
        layer.move(default_layer, 0, 0, 0);
        return layer;
    };

    /**
     * Creates a new buffer. Buffers are invisible, off-screen surfaces. They
     * are implemented in the same manner as layers, but do not provide the
     * same nesting semantics.
     *
     * @return {Layer} The newly-created buffer.
     */
    this.createBuffer = function() {
        var buffer = new Layer$1(0, 0);
        buffer.autosize = 1;
        return buffer;
    };

    /**
     * Flush all pending draw tasks, if possible, as a new frame. If the entire
     * frame is not ready, the flush will wait until all required tasks are
     * unblocked.
     *
     * @param {function} callback The function to call when this frame is
     *                            flushed. This may happen immediately, or
     *                            later when blocked tasks become unblocked.
     */
    this.flush = function(callback) {

        // Add frame, reset tasks
        frames.push(new Frame(callback, tasks));
        tasks = [];

        // Attempt flush
        __flush_frames();

    };

    /**
     * Sets the hotspot and image of the mouse cursor displayed within the
     * Guacamole display.
     *
     * @param {Number} hotspotX The X coordinate of the cursor hotspot.
     * @param {Number} hotspotY The Y coordinate of the cursor hotspot.
     * @param {Layer} layer The source layer containing the data which
     *                                should be used as the mouse cursor image.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      layer's coordinate space to copy data from.

     */
    this.setCursor = function(hotspotX, hotspotY, layer, srcx, srcy, srcw, srch) {
        scheduleTask(function __display_set_cursor() {

            // Set hotspot
            guac_display.cursorHotspotX = hotspotX;
            guac_display.cursorHotspotY = hotspotY;

            // Reset cursor size
            cursor.resize(srcw, srch);

            // Draw cursor to cursor layer
            cursor.copy(layer, srcx, srcy, srcw, srch, 0, 0);
            guac_display.moveCursor(guac_display.cursorX, guac_display.cursorY);

            // Fire cursor change event
            if (guac_display.oncursor)
                guac_display.oncursor(cursor.getCanvas(), hotspotX, hotspotY);

        });
    };

    /**
     * Sets whether the software-rendered cursor is shown. This cursor differs
     * from the hardware cursor in that it is built into the Display,
     * and relies on its own Guacamole layer to render.
     *
     * @param {Boolean} [shown=true] Whether to show the software cursor.
     */
    this.showCursor = function(shown) {

        var element = cursor.getElement();
        var parent = element.parentNode;

        // Remove from DOM if hidden
        if (shown === false) {
            if (parent)
                parent.removeChild(element);
        }

        // Otherwise, ensure cursor is child of display
        else if (parent !== display)
            display.appendChild(element);

    };

    /**
     * Sets the location of the local cursor to the given coordinates. For the
     * sake of responsiveness, this function performs its action immediately.
     * Cursor motion is not maintained within atomic frames.
     *
     * @param {Number} x The X coordinate to move the cursor to.
     * @param {Number} y The Y coordinate to move the cursor to.
     */
    this.moveCursor = function(x, y) {

        // Move cursor layer
        cursor.translate(x - guac_display.cursorHotspotX,
                         y - guac_display.cursorHotspotY);

        // Update stored position
        guac_display.cursorX = x;
        guac_display.cursorY = y;

    };

    /**
     * Changes the size of the given Layer to the given width and height.
     * Resizing is only attempted if the new size provided is actually different
     * from the current size.
     *
     * @param {Layer} layer The layer to resize.
     * @param {Number} width The new width.
     * @param {Number} height The new height.
     */
    this.resize = function(layer, width, height) {
        scheduleTask(function __display_resize() {

            layer.resize(width, height);

            // Resize display if default layer is resized
            if (layer === default_layer) {

                // Update (set) display size
                displayWidth = width;
                displayHeight = height;
                display.style.width = displayWidth + "px";
                display.style.height = displayHeight + "px";

                // Update bounds size
                bounds.style.width = (displayWidth*displayScale) + "px";
                bounds.style.height = (displayHeight*displayScale) + "px";

                // Notify of resize
                if (guac_display.onresize)
                    guac_display.onresize(width, height);

            }

        });
    };

    /**
     * Draws the specified image at the given coordinates. The image specified
     * must already be loaded.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     * @param {Image} image The image to draw. Note that this is an Image
     *                      object - not a URL.
     */
    this.drawImage = function(layer, x, y, image) {
        scheduleTask(function __display_drawImage() {
            layer.drawImage(x, y, image);
        });
    };

    /**
     * Draws the image contained within the specified Blob at the given
     * coordinates. The Blob specified must already be populated with image
     * data.
     *
     * @param {Layer} layer
     *     The layer to draw upon.
     *
     * @param {Number} x
     *     The destination X coordinate.
     *
     * @param {Number} y
     *     The destination Y coordinate.
     *
     * @param {Blob} blob
     *     The Blob containing the image data to draw.
     */
    this.drawBlob = function(layer, x, y, blob) {

        // Create URL for blob
        var url = URL.createObjectURL(blob);

        // Draw and free blob URL when ready
        var task = scheduleTask(function __display_drawBlob() {
            layer.drawImage(x, y, image);
            URL.revokeObjectURL(url);
        }, true);

        // Load image from URL
        var image = new Image();
        image.onload = task.unblock;
        image.src = url;

    };

    /**
     * Draws the image at the specified URL at the given coordinates. The image
     * will be loaded automatically, and this and any future operations will
     * wait for the image to finish loading.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     * @param {String} url The URL of the image to draw.
     */
    this.draw = function(layer, x, y, url) {

        var task = scheduleTask(function __display_draw() {
            layer.drawImage(x, y, image);
        }, true);

        var image = new Image();
        image.onload = task.unblock;
        image.src = url;

    };

    /**
     * Plays the video at the specified URL within this layer. The video
     * will be loaded automatically, and this and any future operations will
     * wait for the video to finish loading. Future operations will not be
     * executed until the video finishes playing.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {String} mimetype The mimetype of the video to play.
     * @param {Number} duration The duration of the video in milliseconds.
     * @param {String} url The URL of the video to play.
     */
    this.play = function(layer, mimetype, duration, url) {

        // Start loading the video
        var video = document.createElement("video");
        video.type = mimetype;
        video.src = url;

        // Start copying frames when playing
        video.addEventListener("play", function() {

            function render_callback() {
                layer.drawImage(0, 0, video);
                if (!video.ended)
                    window.setTimeout(render_callback, 20);
            }

            render_callback();

        }, false);

        scheduleTask(video.play);

    };

    /**
     * Transfer a rectangle of image data from one Layer to this Layer using the
     * specified transfer function.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Layer} dstLayer The layer to draw upon.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     * @param {Function} transferFunction The transfer function to use to
     *                                    transfer data from source to
     *                                    destination.
     */
    this.transfer = function(srcLayer, srcx, srcy, srcw, srch, dstLayer, x, y, transferFunction) {
        scheduleTask(function __display_transfer() {
            dstLayer.transfer(srcLayer, srcx, srcy, srcw, srch, x, y, transferFunction);
        });
    };

    /**
     * Put a rectangle of image data from one Layer to this Layer directly
     * without performing any alpha blending. Simply copy the data.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Layer} dstLayer The layer to draw upon.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     */
    this.put = function(srcLayer, srcx, srcy, srcw, srch, dstLayer, x, y) {
        scheduleTask(function __display_put() {
            dstLayer.put(srcLayer, srcx, srcy, srcw, srch, x, y);
        });
    };

    /**
     * Copy a rectangle of image data from one Layer to this Layer. This
     * operation will copy exactly the image data that will be drawn once all
     * operations of the source Layer that were pending at the time this
     * function was called are complete. This operation will not alter the
     * size of the source Layer even if its autosize property is set to true.
     *
     * @param {Layer} srcLayer The Layer to copy image data from.
     * @param {Number} srcx The X coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcy The Y coordinate of the upper-left corner of the
     *                      rectangle within the source Layer's coordinate
     *                      space to copy data from.
     * @param {Number} srcw The width of the rectangle within the source Layer's
     *                      coordinate space to copy data from.
     * @param {Number} srch The height of the rectangle within the source
     *                      Layer's coordinate space to copy data from.
     * @param {Layer} dstLayer The layer to draw upon.
     * @param {Number} x The destination X coordinate.
     * @param {Number} y The destination Y coordinate.
     */
    this.copy = function(srcLayer, srcx, srcy, srcw, srch, dstLayer, x, y) {
        scheduleTask(function __display_copy() {
            dstLayer.copy(srcLayer, srcx, srcy, srcw, srch, x, y);
        });
    };

    /**
     * Starts a new path at the specified point.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The X coordinate of the point to draw.
     * @param {Number} y The Y coordinate of the point to draw.
     */
    this.moveTo = function(layer, x, y) {
        scheduleTask(function __display_moveTo() {
            layer.moveTo(x, y);
        });
    };

    /**
     * Add the specified line to the current path.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The X coordinate of the endpoint of the line to draw.
     * @param {Number} y The Y coordinate of the endpoint of the line to draw.
     */
    this.lineTo = function(layer, x, y) {
        scheduleTask(function __display_lineTo() {
            layer.lineTo(x, y);
        });
    };

    /**
     * Add the specified arc to the current path.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The X coordinate of the center of the circle which
     *                   will contain the arc.
     * @param {Number} y The Y coordinate of the center of the circle which
     *                   will contain the arc.
     * @param {Number} radius The radius of the circle.
     * @param {Number} startAngle The starting angle of the arc, in radians.
     * @param {Number} endAngle The ending angle of the arc, in radians.
     * @param {Boolean} negative Whether the arc should be drawn in order of
     *                           decreasing angle.
     */
    this.arc = function(layer, x, y, radius, startAngle, endAngle, negative) {
        scheduleTask(function __display_arc() {
            layer.arc(x, y, radius, startAngle, endAngle, negative);
        });
    };

    /**
     * Starts a new path at the specified point.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} cp1x The X coordinate of the first control point.
     * @param {Number} cp1y The Y coordinate of the first control point.
     * @param {Number} cp2x The X coordinate of the second control point.
     * @param {Number} cp2y The Y coordinate of the second control point.
     * @param {Number} x The X coordinate of the endpoint of the curve.
     * @param {Number} y The Y coordinate of the endpoint of the curve.
     */
    this.curveTo = function(layer, cp1x, cp1y, cp2x, cp2y, x, y) {
        scheduleTask(function __display_curveTo() {
            layer.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        });
    };

    /**
     * Closes the current path by connecting the end point with the start
     * point (if any) with a straight line.
     *
     * @param {Layer} layer The layer to draw upon.
     */
    this.close = function(layer) {
        scheduleTask(function __display_close() {
            layer.close();
        });
    };

    /**
     * Add the specified rectangle to the current path.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} x The X coordinate of the upper-left corner of the
     *                   rectangle to draw.
     * @param {Number} y The Y coordinate of the upper-left corner of the
     *                   rectangle to draw.
     * @param {Number} w The width of the rectangle to draw.
     * @param {Number} h The height of the rectangle to draw.
     */
    this.rect = function(layer, x, y, w, h) {
        scheduleTask(function __display_rect() {
            layer.rect(x, y, w, h);
        });
    };

    /**
     * Clip all future drawing operations by the current path. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as fillColor()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} layer The layer to affect.
     */
    this.clip = function(layer) {
        scheduleTask(function __display_clip() {
            layer.clip();
        });
    };

    /**
     * Stroke the current path with the specified color. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {String} cap The line cap style. Can be "round", "square",
     *                     or "butt".
     * @param {String} join The line join style. Can be "round", "bevel",
     *                      or "miter".
     * @param {Number} thickness The line thickness in pixels.
     * @param {Number} r The red component of the color to fill.
     * @param {Number} g The green component of the color to fill.
     * @param {Number} b The blue component of the color to fill.
     * @param {Number} a The alpha component of the color to fill.
     */
    this.strokeColor = function(layer, cap, join, thickness, r, g, b, a) {
        scheduleTask(function __display_strokeColor() {
            layer.strokeColor(cap, join, thickness, r, g, b, a);
        });
    };

    /**
     * Fills the current path with the specified color. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Number} r The red component of the color to fill.
     * @param {Number} g The green component of the color to fill.
     * @param {Number} b The blue component of the color to fill.
     * @param {Number} a The alpha component of the color to fill.
     */
    this.fillColor = function(layer, r, g, b, a) {
        scheduleTask(function __display_fillColor() {
            layer.fillColor(r, g, b, a);
        });
    };

    /**
     * Stroke the current path with the image within the specified layer. The
     * image data will be tiled infinitely within the stroke. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {String} cap The line cap style. Can be "round", "square",
     *                     or "butt".
     * @param {String} join The line join style. Can be "round", "bevel",
     *                      or "miter".
     * @param {Number} thickness The line thickness in pixels.
     * @param {Layer} srcLayer The layer to use as a repeating pattern
     *                                   within the stroke.
     */
    this.strokeLayer = function(layer, cap, join, thickness, srcLayer) {
        scheduleTask(function __display_strokeLayer() {
            layer.strokeLayer(cap, join, thickness, srcLayer);
        });
    };

    /**
     * Fills the current path with the image within the specified layer. The
     * image data will be tiled infinitely within the stroke. The current path
     * is implicitly closed. The current path can continue to be reused
     * for other operations (such as clip()) but a new path will be started
     * once a path drawing operation (path() or rect()) is used.
     *
     * @param {Layer} layer The layer to draw upon.
     * @param {Layer} srcLayer The layer to use as a repeating pattern
     *                                   within the fill.
     */
    this.fillLayer = function(layer, srcLayer) {
        scheduleTask(function __display_fillLayer() {
            layer.fillLayer(srcLayer);
        });
    };

    /**
     * Push current layer state onto stack.
     *
     * @param {Layer} layer The layer to draw upon.
     */
    this.push = function(layer) {
        scheduleTask(function __display_push() {
            layer.push();
        });
    };

    /**
     * Pop layer state off stack.
     *
     * @param {Layer} layer The layer to draw upon.
     */
    this.pop = function(layer) {
        scheduleTask(function __display_pop() {
            layer.pop();
        });
    };

    /**
     * Reset the layer, clearing the stack, the current path, and any transform
     * matrix.
     *
     * @param {Layer} layer The layer to draw upon.
     */
    this.reset = function(layer) {
        scheduleTask(function __display_reset() {
            layer.reset();
        });
    };

    /**
     * Sets the given affine transform (defined with six values from the
     * transform's matrix).
     *
     * @param {Layer} layer The layer to modify.
     * @param {Number} a The first value in the affine transform's matrix.
     * @param {Number} b The second value in the affine transform's matrix.
     * @param {Number} c The third value in the affine transform's matrix.
     * @param {Number} d The fourth value in the affine transform's matrix.
     * @param {Number} e The fifth value in the affine transform's matrix.
     * @param {Number} f The sixth value in the affine transform's matrix.
     */
    this.setTransform = function(layer, a, b, c, d, e, f) {
        scheduleTask(function __display_setTransform() {
            layer.setTransform(a, b, c, d, e, f);
        });
    };

    /**
     * Applies the given affine transform (defined with six values from the
     * transform's matrix).
     *
     * @param {Layer} layer The layer to modify.
     * @param {Number} a The first value in the affine transform's matrix.
     * @param {Number} b The second value in the affine transform's matrix.
     * @param {Number} c The third value in the affine transform's matrix.
     * @param {Number} d The fourth value in the affine transform's matrix.
     * @param {Number} e The fifth value in the affine transform's matrix.
     * @param {Number} f The sixth value in the affine transform's matrix.
     */
    this.transform = function(layer, a, b, c, d, e, f) {
        scheduleTask(function __display_transform() {
            layer.transform(a, b, c, d, e, f);
        });
    };

    /**
     * Sets the channel mask for future operations on this Layer.
     *
     * The channel mask is a Guacamole-specific compositing operation identifier
     * with a single bit representing each of four channels (in order): source
     * image where destination transparent, source where destination opaque,
     * destination where source transparent, and destination where source
     * opaque.
     *
     * @param {Layer} layer The layer to modify.
     * @param {Number} mask The channel mask for future operations on this
     *                      Layer.
     */
    this.setChannelMask = function(layer, mask) {
        scheduleTask(function __display_setChannelMask() {
            layer.setChannelMask(mask);
        });
    };

    /**
     * Sets the miter limit for stroke operations using the miter join. This
     * limit is the maximum ratio of the size of the miter join to the stroke
     * width. If this ratio is exceeded, the miter will not be drawn for that
     * joint of the path.
     *
     * @param {Layer} layer The layer to modify.
     * @param {Number} limit The miter limit for stroke operations using the
     *                       miter join.
     */
    this.setMiterLimit = function(layer, limit) {
        scheduleTask(function __display_setMiterLimit() {
            layer.setMiterLimit(limit);
        });
    };

    /**
     * Sets the scale of the client display element such that it renders at
     * a relatively smaller or larger size, without affecting the true
     * resolution of the display.
     *
     * @param {Number} scale The scale to resize to, where 1.0 is normal
     *                       size (1:1 scale).
     */
    this.scale = function(scale) {

        display.style.transform =
        display.style.WebkitTransform =
        display.style.MozTransform =
        display.style.OTransform =
        display.style.msTransform =

            "scale(" + scale + "," + scale + ")";

        displayScale = scale;

        // Update bounds size
        bounds.style.width = (displayWidth*displayScale) + "px";
        bounds.style.height = (displayHeight*displayScale) + "px";

    };

    /**
     * Returns the scale of the display.
     *
     * @return {Number} The scale of the display.
     */
    this.getScale = function() {
        return displayScale;
    };

    /**
     * Returns a canvas element containing the entire display, with all child
     * layers composited within.
     *
     * @return {HTMLCanvasElement} A new canvas element containing a copy of
     *                             the display.
     */
    this.flatten = function() {

        // Get destination canvas
        var canvas = document.createElement("canvas");
        canvas.width = default_layer.width;
        canvas.height = default_layer.height;

        var context = canvas.getContext("2d");

        // Returns sorted array of children
        function get_children(layer) {

            // Build array of children
            var children = [];
            for (var index in layer.children)
                children.push(layer.children[index]);

            // Sort
            children.sort(function children_comparator(a, b) {

                // Compare based on Z order
                var diff = a.z - b.z;
                if (diff !== 0)
                    return diff;

                // If Z order identical, use document order
                var a_element = a.getElement();
                var b_element = b.getElement();
                var position = b_element.compareDocumentPosition(a_element);

                if (position & Node.DOCUMENT_POSITION_PRECEDING) return -1;
                if (position & Node.DOCUMENT_POSITION_FOLLOWING) return  1;

                // Otherwise, assume same
                return 0;

            });

            // Done
            return children;

        }

        // Draws the contents of the given layer at the given coordinates
        function draw_layer(layer, x, y) {

            // Draw layer
            if (layer.width > 0 && layer.height > 0) {

                // Save and update alpha
                var initial_alpha = context.globalAlpha;
                context.globalAlpha *= layer.alpha / 255.0;

                // Copy data
                context.drawImage(layer.getCanvas(), x, y);

                // Draw all children
                var children = get_children(layer);
                for (var i=0; i<children.length; i++) {
                    var child = children[i];
                    draw_layer(child, x + child.x, y + child.y);
                }

                // Restore alpha
                context.globalAlpha = initial_alpha;

            }

        }

        // Draw default layer and all children
        draw_layer(default_layer, 0, 0);

        // Return new canvas copy
        return canvas;

    };

}
/**
 * Simple container for Layer, allowing layers to be easily
 * repositioned and nested. This allows certain operations to be accelerated
 * through DOM manipulation, rather than raster operations.
 *
 * @constructor
 * @augments Layer
 * @param {Number} width The width of the Layer, in pixels. The canvas element
 *                       backing this Layer will be given this width.
 * @param {Number} height The height of the Layer, in pixels. The canvas element
 *                        backing this Layer will be given this height.
 */
Display.VisibleLayer = function(width, height) {

    Layer$1.apply(this, [width, height]);

    /**
     * Reference to this layer.
     * @private
     */
    var layer = this;

    /**
     * Identifier which uniquely identifies this layer. This is COMPLETELY
     * UNRELATED to the index of the underlying layer, which is specific
     * to the Guacamole protocol, and not relevant at this level.
     *
     * @private
     * @type {Number}
     */
    this.__unique_id = Display.VisibleLayer.__next_id++;

    /**
     * The opacity of the layer container, where 255 is fully opaque and 0 is
     * fully transparent.
     */
    this.alpha = 0xFF;

    /**
     * X coordinate of the upper-left corner of this layer container within
     * its parent, in pixels.
     * @type {Number}
     */
    this.x = 0;

    /**
     * Y coordinate of the upper-left corner of this layer container within
     * its parent, in pixels.
     * @type {Number}
     */
    this.y = 0;

    /**
     * Z stacking order of this layer relative to other sibling layers.
     * @type {Number}
     */
    this.z = 0;

    /**
     * The affine transformation applied to this layer container. Each element
     * corresponds to a value from the transformation matrix, with the first
     * three values being the first row, and the last three values being the
     * second row. There are six values total.
     *
     * @type {Number[]}
     */
    this.matrix = [1, 0, 0, 1, 0, 0];

    /**
     * The parent layer container of this layer, if any.
     * @type {Display.VisibleLayer}
     */
    this.parent = null;

    /**
     * Set of all children of this layer, indexed by layer index. This object
     * will have one property per child.
     */
    this.children = {};

    // Set layer position
    var canvas = layer.getCanvas();
    canvas.style.position = "absolute";
    canvas.style.left = "0px";
    canvas.style.top = "0px";

    // Create div with given size
    var div = document.createElement("div");
    div.appendChild(canvas);
    div.style.width = width + "px";
    div.style.height = height + "px";
    div.style.position = "absolute";
    div.style.left = "0px";
    div.style.top = "0px";
    div.style.overflow = "hidden";

    /**
     * Superclass resize() function.
     * @private
     */
    var __super_resize = this.resize;

    this.resize = function(width, height) {

        // Resize containing div
        div.style.width = width + "px";
        div.style.height = height + "px";

        __super_resize(width, height);

    };

    /**
     * Returns the element containing the canvas and any other elements
     * associated with this layer.
     * @returns {Element} The element containing this layer's canvas.
     */
    this.getElement = function() {
        return div;
    };

    /**
     * The translation component of this layer's transform.
     * @private
     */
    var translate = "translate(0px, 0px)"; // (0, 0)

    /**
     * The arbitrary matrix component of this layer's transform.
     * @private
     */
    var matrix = "matrix(1, 0, 0, 1, 0, 0)"; // Identity

    /**
     * Moves the upper-left corner of this layer to the given X and Y
     * coordinate.
     *
     * @param {Number} x The X coordinate to move to.
     * @param {Number} y The Y coordinate to move to.
     */
    this.translate = function(x, y) {

        layer.x = x;
        layer.y = y;

        // Generate translation
        translate = "translate("
                        + x + "px,"
                        + y + "px)";

        // Set layer transform
        div.style.transform =
        div.style.WebkitTransform =
        div.style.MozTransform =
        div.style.OTransform =
        div.style.msTransform =

            translate + " " + matrix;

    };

    /**
     * Moves the upper-left corner of this VisibleLayer to the given X and Y
     * coordinate, sets the Z stacking order, and reparents this VisibleLayer
     * to the given VisibleLayer.
     *
     * @param {Display.VisibleLayer} parent The parent to set.
     * @param {Number} x The X coordinate to move to.
     * @param {Number} y The Y coordinate to move to.
     * @param {Number} z The Z coordinate to move to.
     */
    this.move = function(parent, x, y, z) {

        // Set parent if necessary
        if (layer.parent !== parent) {

            // Maintain relationship
            if (layer.parent)
                delete layer.parent.children[layer.__unique_id];
            layer.parent = parent;
            parent.children[layer.__unique_id] = layer;

            // Reparent element
            var parent_element = parent.getElement();
            parent_element.appendChild(div);

        }

        // Set location
        layer.translate(x, y);
        layer.z = z;
        div.style.zIndex = z;

    };

    /**
     * Sets the opacity of this layer to the given value, where 255 is fully
     * opaque and 0 is fully transparent.
     *
     * @param {Number} a The opacity to set.
     */
    this.shade = function(a) {
        layer.alpha = a;
        div.style.opacity = a/255.0;
    };

    /**
     * Removes this layer container entirely, such that it is no longer
     * contained within its parent layer, if any.
     */
    this.dispose = function() {

        // Remove from parent container
        if (layer.parent) {
            delete layer.parent.children[layer.__unique_id];
            layer.parent = null;
        }

        // Remove from parent element
        if (div.parentNode)
            div.parentNode.removeChild(div);

    };

    /**
     * Applies the given affine transform (defined with six values from the
     * transform's matrix).
     *
     * @param {Number} a The first value in the affine transform's matrix.
     * @param {Number} b The second value in the affine transform's matrix.
     * @param {Number} c The third value in the affine transform's matrix.
     * @param {Number} d The fourth value in the affine transform's matrix.
     * @param {Number} e The fifth value in the affine transform's matrix.
     * @param {Number} f The sixth value in the affine transform's matrix.
     */
    this.distort = function(a, b, c, d, e, f) {

        // Store matrix
        layer.matrix = [a, b, c, d, e, f];

        // Generate matrix transformation
        matrix =

            /* a c e
             * b d f
             * 0 0 1
             */

            "matrix(" + a + "," + b + "," + c + "," + d + "," + e + "," + f + ")";

        // Set layer transform
        div.style.transform =
        div.style.WebkitTransform =
        div.style.MozTransform =
        div.style.OTransform =
        div.style.msTransform =

            translate + " " + matrix;

    };

};

/**
 * The next identifier to be assigned to the layer container. This identifier
 * uniquely identifies each VisibleLayer, but is unrelated to the index of
 * the layer, which exists at the protocol/client level only.
 *
 * @private
 * @type {Number}
 */
Display.VisibleLayer.__next_id = 0;

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Integer pool which returns consistently increasing integers while integers
 * are in use, and previously-used integers when possible.
 * @constructor
 */
function IntegerPool() {

    /**
     * Reference to this integer pool.
     *
     * @private
     */
    var guac_pool = this;

    /**
     * Array of available integers.
     *
     * @private
     * @type {Number[]}
     */
    var pool = [];

    /**
     * The next integer to return if no more integers remain.
     * @type {Number}
     */
    this.next_int = 0;

    /**
     * Returns the next available integer in the pool. If possible, a previously
     * used integer will be returned.
     *
     * @return {Number} The next available integer.
     */
    this.next = function() {

        // If free'd integers exist, return one of those
        if (pool.length > 0)
            return pool.shift();

        // Otherwise, return a new integer
        return guac_pool.next_int++;

    };

    /**
     * Frees the given integer, allowing it to be reused.
     *
     * @param {Number} integer The integer to free.
     */
    this.free = function(integer) {
        pool.push(integer);
    };

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A writer which automatically writes to the given output stream with text
 * data.
 *
 * @constructor
 * @param {OutputStream} stream The stream that data will be written
 *                                        to.
 */
function StringWriter(stream) {

    /**
     * Reference to this StringWriter.
     * @private
     */
    var guac_writer = this;

    /**
     * Wrapped ArrayBufferWriter.
     * @private
     * @type {ArrayBufferWriter}
     */
    var array_writer = new ArrayBufferWriter(stream);

    /**
     * Internal buffer for UTF-8 output.
     * @private
     */
    var buffer = new Uint8Array(8192);

    /**
     * The number of bytes currently in the buffer.
     * @private
     */
    var length = 0;

    // Simply call onack for acknowledgements
    array_writer.onack = function(status) {
        if (guac_writer.onack)
            guac_writer.onack(status);
    };

    /**
     * Expands the size of the underlying buffer by the given number of bytes,
     * updating the length appropriately.
     *
     * @private
     * @param {Number} bytes The number of bytes to add to the underlying
     *                       buffer.
     */
    function __expand(bytes) {

        // Resize buffer if more space needed
        if (length+bytes >= buffer.length) {
            var new_buffer = new Uint8Array((length+bytes)*2);
            new_buffer.set(buffer);
            buffer = new_buffer;
        }

        length += bytes;

    }

    /**
     * Appends a single Unicode character to the current buffer, resizing the
     * buffer if necessary. The character will be encoded as UTF-8.
     *
     * @private
     * @param {Number} codepoint The codepoint of the Unicode character to
     *                           append.
     */
    function __append_utf8(codepoint) {

        var mask;
        var bytes;

        // 1 byte
        if (codepoint <= 0x7F) {
            mask = 0x00;
            bytes = 1;
        }

        // 2 byte
        else if (codepoint <= 0x7FF) {
            mask = 0xC0;
            bytes = 2;
        }

        // 3 byte
        else if (codepoint <= 0xFFFF) {
            mask = 0xE0;
            bytes = 3;
        }

        // 4 byte
        else if (codepoint <= 0x1FFFFF) {
            mask = 0xF0;
            bytes = 4;
        }

        // If invalid codepoint, append replacement character
        else {
            __append_utf8(0xFFFD);
            return;
        }

        // Offset buffer by size
        __expand(bytes);
        var offset = length - 1;

        // Add trailing bytes, if any
        for (var i=1; i<bytes; i++) {
            buffer[offset--] = 0x80 | (codepoint & 0x3F);
            codepoint >>= 6;
        }

        // Set initial byte
        buffer[offset] = mask | codepoint;

    }

    /**
     * Encodes the given string as UTF-8, returning an ArrayBuffer containing
     * the resulting bytes.
     *
     * @private
     * @param {String} text The string to encode as UTF-8.
     * @return {Uint8Array} The encoded UTF-8 data.
     */
    function __encode_utf8(text) {

        // Fill buffer with UTF-8
        for (var i=0; i<text.length; i++) {
            var codepoint = text.charCodeAt(i);
            __append_utf8(codepoint);
        }

        // Flush buffer
        if (length > 0) {
            var out_buffer = buffer.subarray(0, length);
            length = 0;
            return out_buffer;
        }

    }

    /**
     * Sends the given text.
     *
     * @param {String} text The text to send.
     */
    this.sendText = function(text) {
        array_writer.sendData(__encode_utf8(text));
    };

    /**
     * Signals that no further text will be sent, effectively closing the
     * stream.
     */
    this.sendEnd = function() {
        array_writer.sendEnd();
    };

    /**
     * Fired for received data, if acknowledged by the server.
     * @event
     * @param {Status} status The status of the operation.
     */
    this.onack = null;

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Abstract stream which can receive data.
 *
 * @constructor
 * @param {Client} client The client owning this stream.
 * @param {Number} index The index of this stream.
 */
function OutputStream(client, index) {

    /**
     * Reference to this stream.
     * @private
     */
    var guac_stream = this;

    /**
     * The index of this stream.
     * @type {Number}
     */
    this.index = index;

    /**
     * Fired whenever an acknowledgement is received from the server, indicating
     * that a stream operation has completed, or an error has occurred.
     *
     * @event
     * @param {Status} status The status of the operation.
     */
    this.onack = null;

    /**
     * Writes the given base64-encoded data to this stream as a blob.
     *
     * @param {String} data The base64-encoded data to send.
     */
    this.sendBlob = function(data) {
        client.sendBlob(guac_stream.index, data);
    };

    /**
     * Closes this stream.
     */
    this.sendEnd = function() {
        client.endStream(guac_stream.index);
    };

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Simple Guacamole protocol parser that invokes an oninstruction event when
 * full instructions are available from data received via receive().
 *
 * @constructor
 */
function Parser() {

    /**
     * Reference to this parser.
     * @private
     */
    var parser = this;

    /**
     * Current buffer of received data. This buffer grows until a full
     * element is available. After a full element is available, that element
     * is flushed into the element buffer.
     *
     * @private
     */
    var buffer = "";

    /**
     * Buffer of all received, complete elements. After an entire instruction
     * is read, this buffer is flushed, and a new instruction begins.
     *
     * @private
     */
    var element_buffer = [];

    // The location of the last element's terminator
    var element_end = -1;

    // Where to start the next length search or the next element
    var start_index = 0;

    /**
     * Appends the given instruction data packet to the internal buffer of
     * this Parser, executing all completed instructions at
     * the beginning of this buffer, if any.
     *
     * @param {String} packet The instruction data to receive.
     */
    this.receive = function(packet) {

        // Truncate buffer as necessary
        if (start_index > 4096 && element_end >= start_index) {

            buffer = buffer.substring(start_index);

            // Reset parse relative to truncation
            element_end -= start_index;
            start_index = 0;

        }

        // Append data to buffer
        buffer += packet;

        // While search is within currently received data
        while (element_end < buffer.length) {

            // If we are waiting for element data
            if (element_end >= start_index) {

                // We now have enough data for the element. Parse.
                var element = buffer.substring(start_index, element_end);
                var terminator = buffer.substring(element_end, element_end+1);

                // Add element to array
                element_buffer.push(element);

                // If last element, handle instruction
                if (terminator == ";") {

                    // Get opcode
                    var opcode = element_buffer.shift();

                    // Call instruction handler.
                    if (parser.oninstruction != null)
                        parser.oninstruction(opcode, element_buffer);

                    // Clear elements
                    element_buffer.length = 0;

                }
                else if (terminator != ',')
                    throw new Error("Illegal terminator.");

                // Start searching for length at character after
                // element terminator
                start_index = element_end + 1;

            }

            // Search for end of length
            var length_end = buffer.indexOf(".", start_index);
            if (length_end != -1) {

                // Parse length
                var length = parseInt(buffer.substring(element_end+1, length_end));
                if (length == NaN)
                    throw new Error("Non-numeric character in element length.");

                // Calculate start of element
                start_index = length_end + 1;

                // Calculate location of element terminator
                element_end = start_index + length;

            }

            // If no period yet, continue search when more data
            // is received
            else {
                start_index = buffer.length;
                break;
            }

        } // end parse loop

    };

    /**
     * Fired once for every complete Guacamole instruction received, in order.
     *
     * @event
     * @param {String} opcode The Guacamole instruction opcode.
     * @param {Array} parameters The parameters provided for the instruction,
     *                           if any.
     */
    this.oninstruction = null;

}

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Abstract video player which accepts, queues and plays back arbitrary video
 * data. It is up to implementations of this class to provide some means of
 * handling a provided InputStream and rendering the received data to
 * the provided Display.VisibleLayer. Data received along the
 * provided stream is to be played back immediately.
 *
 * @constructor
 */
function VideoPlayer() {

    /**
     * Notifies this VideoPlayer that all video up to the current
     * point in time has been given via the underlying stream, and that any
     * difference in time between queued video data and the current time can be
     * considered latency.
     */
    this.sync = function sync() {
        // Default implementation - do nothing
    };

}
/**
 * Determines whether the given mimetype is supported by any built-in
 * implementation of VideoPlayer, and thus will be properly handled
 * by VideoPlayer.getInstance().
 *
 * @param {String} mimetype
 *     The mimetype to check.
 *
 * @returns {Boolean}
 *     true if the given mimetype is supported by any built-in
 *     VideoPlayer, false otherwise.
 */
VideoPlayer.isSupportedType = function isSupportedType(mimetype) {

    // There are currently no built-in video players (and therefore no
    // supported types)
    return false;

};

/**
 * Returns a list of all mimetypes supported by any built-in
 * VideoPlayer, in rough order of priority. Beware that only the core
 * mimetypes themselves will be listed. Any mimetype parameters, even required
 * ones, will not be included in the list.
 *
 * @returns {String[]}
 *     A list of all mimetypes supported by any built-in VideoPlayer,
 *     excluding any parameters.
 */
VideoPlayer.getSupportedTypes = function getSupportedTypes() {

    // There are currently no built-in video players (and therefore no
    // supported types)
    return [];

};

/**
 * Returns an instance of VideoPlayer providing support for the given
 * video format. If support for the given video format is not available, null
 * is returned.
 *
 * @param {InputStream} stream
 *     The InputStream to read video data from.
 *
 * @param {Display.VisibleLayer} layer
 *     The destination layer in which this VideoPlayer should play
 *     the received video data.
 *
 * @param {String} mimetype
 *     The mimetype of the video data in the provided stream.
 *
 * @return {VideoPlayer}
 *     A VideoPlayer instance supporting the given mimetype and
 *     reading from the given stream, or null if support for the given mimetype
 *     is absent.
 */
VideoPlayer.getInstance = function getInstance(stream, layer, mimetype) {

    // There are currently no built-in video players
    return null;

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * An input stream abstraction used by the Guacamole client to facilitate
 * transfer of files or other binary data.
 *
 * @constructor
 * @param {Client} client The client owning this stream.
 * @param {Number} index The index of this stream.
 */
function InputStream(client, index) {

    /**
     * Reference to this stream.
     * @private
     */
    var guac_stream = this;

    /**
     * The index of this stream.
     * @type {Number}
     */
    this.index = index;

    /**
     * Called when a blob of data is received.
     *
     * @event
     * @param {String} data The received base64 data.
     */
    this.onblob = null;

    /**
     * Called when this stream is closed.
     *
     * @event
     */
    this.onend = null;

    /**
     * Acknowledges the receipt of a blob.
     *
     * @param {String} message A human-readable message describing the error
     *                         or status.
     * @param {Number} code The error code, if any, or 0 for success.
     */
    this.sendAck = function(message, code) {
        client.sendAck(guac_stream.index, message, code);
    };

}

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A reader which automatically handles the given input stream, returning
 * received blobs as a single data URI built over the course of the stream.
 * Note that this object will overwrite any installed event handlers on the
 * given InputStream.
 *
 * @constructor
 * @param {InputStream} stream
 *     The stream that data will be read from.
 */
function DataURIReader(stream, mimetype) {

    /**
     * Reference to this DataURIReader.
     * @private
     */
    var guac_reader = this;

    /**
     * Current data URI.
     *
     * @private
     * @type {String}
     */
    var uri = 'data:' + mimetype + ';base64,';

    // Receive blobs as array buffers
    stream.onblob = function dataURIReaderBlob(data) {

        // Currently assuming data will ALWAYS be safe to simply append. This
        // will not be true if the received base64 data encodes a number of
        // bytes that isn't a multiple of three (as base64 expands in a ratio
        // of exactly 3:4).
        uri += data;

    };

    // Simply call onend when end received
    stream.onend = function dataURIReaderEnd() {
        if (guac_reader.onend)
            guac_reader.onend();
    };

    /**
     * Returns the data URI of all data received through the underlying stream
     * thus far.
     *
     * @returns {String}
     *     The data URI of all data received through the underlying stream thus
     *     far.
     */
    this.getURI = function getURI() {
        return uri;
    };

    /**
     * Fired once this stream is finished and no further data will be written.
     *
     * @event
     */
    this.onend = null;

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * An object used by the Guacamole client to house arbitrarily-many named
 * input and output streams.
 *
 * @constructor
 * @param {Client} client
 *     The client owning this object.
 *
 * @param {Number} index
 *     The index of this object.
 */
function guacamoleObject(client, index) {

    /**
     * Reference to this GObject.
     *
     * @private
     * @type {GObject}
     */
    var guacObject = this;

    /**
     * Map of stream name to corresponding queue of callbacks. The queue of
     * callbacks is guaranteed to be in order of request.
     *
     * @private
     * @type {Object.<String, Function[]>}
     */
    var bodyCallbacks = {};

    /**
     * Removes and returns the callback at the head of the callback queue for
     * the stream having the given name. If no such callbacks exist, null is
     * returned.
     *
     * @private
     * @param {String} name
     *     The name of the stream to retrieve a callback for.
     *
     * @returns {Function}
     *     The next callback associated with the stream having the given name,
     *     or null if no such callback exists.
     */
    var dequeueBodyCallback = function dequeueBodyCallback(name) {

        // If no callbacks defined, simply return null
        var callbacks = bodyCallbacks[name];
        if (!callbacks)
            return null;

        // Otherwise, pull off first callback, deleting the queue if empty
        var callback = callbacks.shift();
        if (callbacks.length === 0)
            delete bodyCallbacks[name];

        // Return found callback
        return callback;

    };

    /**
     * Adds the given callback to the tail of the callback queue for the stream
     * having the given name.
     *
     * @private
     * @param {String} name
     *     The name of the stream to associate with the given callback.
     *
     * @param {Function} callback
     *     The callback to add to the queue of the stream with the given name.
     */
    var enqueueBodyCallback = function enqueueBodyCallback(name, callback) {

        // Get callback queue by name, creating first if necessary
        var callbacks = bodyCallbacks[name];
        if (!callbacks) {
            callbacks = [];
            bodyCallbacks[name] = callbacks;
        }

        // Add callback to end of queue
        callbacks.push(callback);

    };

    /**
     * The index of this object.
     *
     * @type {Number}
     */
    this.index = index;

    /**
     * Called when this object receives the body of a requested input stream.
     * By default, all objects will invoke the callbacks provided to their
     * requestInputStream() functions based on the name of the stream
     * requested. This behavior can be overridden by specifying a different
     * handler here.
     *
     * @event
     * @param {InputStream} inputStream
     *     The input stream of the received body.
     *
     * @param {String} mimetype
     *     The mimetype of the data being received.
     *
     * @param {String} name
     *     The name of the stream whose body has been received.
     */
    this.onbody = function defaultBodyHandler(inputStream, mimetype, name) {

        // Call queued callback for the received body, if any
        var callback = dequeueBodyCallback(name);
        if (callback)
            callback(inputStream, mimetype);

    };

    /**
     * Called when this object is being undefined. Once undefined, no further
     * communication involving this object may occur.
     *
     * @event
     */
    this.onundefine = null;

    /**
     * Requests read access to the input stream having the given name. If
     * successful, a new input stream will be created.
     *
     * @param {String} name
     *     The name of the input stream to request.
     *
     * @param {Function} [bodyCallback]
     *     The callback to invoke when the body of the requested input stream
     *     is received. This callback will be provided a InputStream
     *     and its mimetype as its two only arguments. If the onbody handler of
     *     this object is overridden, this callback will not be invoked.
     */
    this.requestInputStream = function requestInputStream(name, bodyCallback) {

        // Queue body callback if provided
        if (bodyCallback)
            enqueueBodyCallback(name, bodyCallback);

        // Send request for input stream
        client.requestObjectInputStream(guacObject.index, name);

    };

    /**
     * Creates a new output stream associated with this object and having the
     * given mimetype and name. The legality of a mimetype and name is dictated
     * by the object itself.
     *
     * @param {String} mimetype
     *     The mimetype of the data which will be sent to the output stream.
     *
     * @param {String} name
     *     The defined name of an output stream within this object.
     *
     * @returns {OutputStream}
     *     An output stream which will write blobs to the named output stream
     *     of this object.
     */
    this.createOutputStream = function createOutputStream(mimetype, name) {
        return client.createObjectOutputStream(guacObject.index, mimetype, name);
    };

}
/**
 * The reserved name denoting the root stream of any object. The contents of
 * the root stream MUST be a JSON map of stream name to mimetype.
 *
 * @constant
 * @type {String}
 */
GObject.ROOT_STREAM = '/';

/**
 * The mimetype of a stream containing JSON which maps available stream names
 * to their corresponding mimetype. The root stream of a GObject MUST
 * have this mimetype.
 *
 * @constant
 * @type {String}
 */
GObject.STREAM_INDEX_MIMETYPE = 'application/vnd.glyptodon.guacamole.stream-index+json';

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Guacamole protocol client. Given a {@link Tunnel},
 * automatically handles incoming and outgoing Guacamole instructions via the
 * provided tunnel, updating its display using one or more canvas elements.
 *
 * @constructor
 * @param {Tunnel} tunnel The tunnel to use to send and receive
 *                                  Guacamole instructions.
 */
function Client(tunnel) {

    var guac_client = this;

    var STATE_IDLE          = 0;
    var STATE_CONNECTING    = 1;
    var STATE_WAITING       = 2;
    var STATE_CONNECTED     = 3;
    var STATE_DISCONNECTING = 4;
    var STATE_DISCONNECTED  = 5;

    var currentState = STATE_IDLE;

    var currentTimestamp = 0;
    var pingInterval = null;

    /**
     * Translation from Guacamole protocol line caps to Layer line caps.
     * @private
     */
    var lineCap = {
        0: "butt",
        1: "round",
        2: "square"
    };

    /**
     * Translation from Guacamole protocol line caps to Layer line caps.
     * @private
     */
    var lineJoin = {
        0: "bevel",
        1: "miter",
        2: "round"
    };

    /**
     * The underlying Guacamole display.
     *
     * @private
     * @type {Display}
     */
    var display = new Display$1();

    /**
     * All available layers and buffers
     *
     * @private
     * @type {Object.<Number, (Display.VisibleLayer|Layer)>}
     */
    var layers = {};

    /**
     * All audio players currently in use by the client. Initially, this will
     * be empty, but audio players may be allocated by the server upon request.
     *
     * @private
     * @type {Object.<Number, AudioPlayer>}
     */
    var audioPlayers = {};

    // No initial parsers
    var parsers = [];

    // No initial streams
    var streams = [];

    /**
     * All current objects. The index of each object is dictated by the
     * Guacamole server.
     *
     * @private
     * @type {GObject[]}
     */
    var objects = [];

    // Pool of available stream indices
    var stream_indices = new IntegerPool();

    // Array of allocated output streams by index
    var output_streams = [];

    function setState(state) {
        if (state != currentState) {
            currentState = state;
            if (guac_client.onstatechange)
                guac_client.onstatechange(currentState);
        }
    }

    function isConnected() {
        return currentState == STATE_CONNECTED
            || currentState == STATE_WAITING;
    }

    /**
     * Returns the underlying display of this Client. The display
     * contains an Element which can be added to the DOM, causing the
     * display to become visible.
     *
     * @return {Display} The underlying display of this
     *                             Client.
     */
    this.getDisplay = function() {
        return display;
    };

    /**
     * Sends the current size of the screen.
     *
     * @param {Number} width The width of the screen.
     * @param {Number} height The height of the screen.
     */
    this.sendSize = function(width, height) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("size", width, height);

    };

    /**
     * Sends a key event having the given properties as if the user
     * pressed or released a key.
     *
     * @param {Boolean} pressed Whether the key is pressed (true) or released
     *                          (false).
     * @param {Number} keysym The keysym of the key being pressed or released.
     */
    this.sendKeyEvent = function(pressed, keysym) {
        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("key", keysym, pressed);
    };

    /**
     * Sends a mouse event having the properties provided by the given mouse
     * state.
     *
     * @param {Mouse.State} mouseState The state of the mouse to send
     *                                           in the mouse event.
     */
    this.sendMouseState = function(mouseState) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        // Update client-side cursor
        display.moveCursor(
            Math.floor(mouseState.x),
            Math.floor(mouseState.y)
        );

        // Build mask
        var buttonMask = 0;
        if (mouseState.left)   buttonMask |= 1;
        if (mouseState.middle) buttonMask |= 2;
        if (mouseState.right)  buttonMask |= 4;
        if (mouseState.up)     buttonMask |= 8;
        if (mouseState.down)   buttonMask |= 16;

        // Send message
        tunnel.sendMessage("mouse", Math.floor(mouseState.x), Math.floor(mouseState.y), buttonMask);
    };

    /**
     * Sets the clipboard of the remote client to the given text data.
     *
     * @deprecated Use createClipboardStream() instead.
     * @param {String} data The data to send as the clipboard contents.
     */
    this.setClipboard = function(data) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        // Open stream
        var stream = guac_client.createClipboardStream("text/plain");
        var writer = new StringWriter(stream);

        // Send text chunks
        for (var i=0; i<data.length; i += 4096)
            writer.sendText(data.substring(i, i+4096));

        // Close stream
        writer.sendEnd();

    };

    /**
     * Opens a new file for writing, having the given index, mimetype and
     * filename.
     *
     * @param {String} mimetype The mimetype of the file being sent.
     * @param {String} filename The filename of the file being sent.
     * @return {OutputStream} The created file stream.
     */
    this.createFileStream = function(mimetype, filename) {

        // Allocate index
        var index = stream_indices.next();

        // Create new stream
        tunnel.sendMessage("file", index, mimetype, filename);
        var stream = output_streams[index] = new OutputStream(guac_client, index);

        // Override sendEnd() of stream to automatically free index
        var old_end = stream.sendEnd;
        stream.sendEnd = function() {
            old_end();
            stream_indices.free(index);
            delete output_streams[index];
        };

        // Return new, overridden stream
        return stream;

    };

    /**
     * Opens a new pipe for writing, having the given name and mimetype.
     *
     * @param {String} mimetype The mimetype of the data being sent.
     * @param {String} name The name of the pipe.
     * @return {OutputStream} The created file stream.
     */
    this.createPipeStream = function(mimetype, name) {

        // Allocate index
        var index = stream_indices.next();

        // Create new stream
        tunnel.sendMessage("pipe", index, mimetype, name);
        var stream = output_streams[index] = new OutputStream(guac_client, index);

        // Override sendEnd() of stream to automatically free index
        var old_end = stream.sendEnd;
        stream.sendEnd = function() {
            old_end();
            stream_indices.free(index);
            delete output_streams[index];
        };

        // Return new, overridden stream
        return stream;

    };

    /**
     * Opens a new clipboard object for writing, having the given mimetype.
     *
     * @param {String} mimetype The mimetype of the data being sent.
     * @param {String} name The name of the pipe.
     * @return {OutputStream} The created file stream.
     */
    this.createClipboardStream = function(mimetype) {

        // Allocate index
        var index = stream_indices.next();

        // Create new stream
        tunnel.sendMessage("clipboard", index, mimetype);
        var stream = output_streams[index] = new OutputStream(guac_client, index);

        // Override sendEnd() of stream to automatically free index
        var old_end = stream.sendEnd;
        stream.sendEnd = function() {
            old_end();
            stream_indices.free(index);
            delete output_streams[index];
        };

        // Return new, overridden stream
        return stream;

    };

    /**
     * Creates a new output stream associated with the given object and having
     * the given mimetype and name. The legality of a mimetype and name is
     * dictated by the object itself.
     *
     * @param {Number} index
     *     The index of the object for which the output stream is being
     *     created.
     *
     * @param {String} mimetype
     *     The mimetype of the data which will be sent to the output stream.
     *
     * @param {String} name
     *     The defined name of an output stream within the given object.
     *
     * @returns {OutputStream}
     *     An output stream which will write blobs to the named output stream
     *     of the given object.
     */
    this.createObjectOutputStream = function createObjectOutputStream(index, mimetype, name) {

        // Allocate index
        var streamIndex = stream_indices.next();

        // Create new stream
        tunnel.sendMessage("put", index, streamIndex, mimetype, name);
        var stream = output_streams[streamIndex] = new OutputStream(guac_client, streamIndex);

        // Override sendEnd() of stream to automatically free index
        var oldEnd = stream.sendEnd;
        stream.sendEnd = function freeStreamIndex() {
            oldEnd();
            stream_indices.free(streamIndex);
            delete output_streams[streamIndex];
        };

        // Return new, overridden stream
        return stream;

    };

    /**
     * Requests read access to the input stream having the given name. If
     * successful, a new input stream will be created.
     *
     * @param {Number} index
     *     The index of the object from which the input stream is being
     *     requested.
     *
     * @param {String} name
     *     The name of the input stream to request.
     */
    this.requestObjectInputStream = function requestObjectInputStream(index, name) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("get", index, name);
    };

    /**
     * Acknowledge receipt of a blob on the stream with the given index.
     *
     * @param {Number} index The index of the stream associated with the
     *                       received blob.
     * @param {String} message A human-readable message describing the error
     *                         or status.
     * @param {Number} code The error code, if any, or 0 for success.
     */
    this.sendAck = function(index, message, code) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("ack", index, message, code);
    };

    /**
     * Given the index of a file, writes a blob of data to that file.
     *
     * @param {Number} index The index of the file to write to.
     * @param {String} data Base64-encoded data to write to the file.
     */
    this.sendBlob = function(index, data) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("blob", index, data);
    };

    /**
     * Marks a currently-open stream as complete.
     *
     * @param {Number} index The index of the stream to end.
     */
    this.endStream = function(index) {

        // Do not send requests if not connected
        if (!isConnected())
            return;

        tunnel.sendMessage("end", index);
    };

    /**
     * Fired whenever the state of this Client changes.
     *
     * @event
     * @param {Number} state The new state of the client.
     */
    this.onstatechange = null;

    /**
     * Fired when the remote client sends a name update.
     *
     * @event
     * @param {String} name The new name of this client.
     */
    this.onname = null;

    /**
     * Fired when an error is reported by the remote client, and the connection
     * is being closed.
     *
     * @event
     * @param {Status} status A status object which describes the
     *                                  error.
     */
    this.onerror = null;

    /**
     * Fired when a audio stream is created. The stream provided to this event
     * handler will contain its own event handlers for received data.
     *
     * @event
     * @param {InputStream} stream
     *     The stream that will receive audio data from the server.
     *
     * @param {String} mimetype
     *     The mimetype of the audio data which will be received.
     *
     * @return {AudioPlayer}
     *     An object which implements the AudioPlayer interface and
     *     has been initialied to play the data in the provided stream, or null
     *     if the built-in audio players of the Guacamole client should be
     *     used.
     */
    this.onaudio = null;

    /**
     * Fired when a video stream is created. The stream provided to this event
     * handler will contain its own event handlers for received data.
     *
     * @event
     * @param {InputStream} stream
     *     The stream that will receive video data from the server.
     *
     * @param {Display.VisibleLayer} layer
     *     The destination layer on which the received video data should be
     *     played. It is the responsibility of the VideoPlayer
     *     implementation to play the received data within this layer.
     *
     * @param {String} mimetype
     *     The mimetype of the video data which will be received.
     *
     * @return {VideoPlayer}
     *     An object which implements the VideoPlayer interface and
     *     has been initialied to play the data in the provided stream, or null
     *     if the built-in video players of the Guacamole client should be
     *     used.
     */
    this.onvideo = null;

    /**
     * Fired when the clipboard of the remote client is changing.
     *
     * @event
     * @param {InputStream} stream The stream that will receive
     *                                       clipboard data from the server.
     * @param {String} mimetype The mimetype of the data which will be received.
     */
    this.onclipboard = null;

    /**
     * Fired when a file stream is created. The stream provided to this event
     * handler will contain its own event handlers for received data.
     *
     * @event
     * @param {InputStream} stream The stream that will receive data
     *                                       from the server.
     * @param {String} mimetype The mimetype of the file received.
     * @param {String} filename The name of the file received.
     */
    this.onfile = null;

    /**
     * Fired when a filesystem object is created. The object provided to this
     * event handler will contain its own event handlers and functions for
     * requesting and handling data.
     *
     * @event
     * @param {GObject} object
     *     The created filesystem object.
     *
     * @param {String} name
     *     The name of the filesystem.
     */
    this.onfilesystem = null;

    /**
     * Fired when a pipe stream is created. The stream provided to this event
     * handler will contain its own event handlers for received data;
     *
     * @event
     * @param {InputStream} stream The stream that will receive data
     *                                       from the server.
     * @param {String} mimetype The mimetype of the data which will be received.
     * @param {String} name The name of the pipe.
     */
    this.onpipe = null;

    /**
     * Fired whenever a sync instruction is received from the server, indicating
     * that the server is finished processing any input from the client and
     * has sent any results.
     *
     * @event
     * @param {Number} timestamp The timestamp associated with the sync
     *                           instruction.
     */
    this.onsync = null;

    /**
     * Returns the layer with the given index, creating it if necessary.
     * Positive indices refer to visible layers, an index of zero refers to
     * the default layer, and negative indices refer to buffers.
     *
     * @private
     * @param {Number} index
     *     The index of the layer to retrieve.
     *
     * @return {Display.VisibleLayer|Layer}
     *     The layer having the given index.
     */
    var getLayer = function getLayer(index) {

        // Get layer, create if necessary
        var layer = layers[index];
        if (!layer) {

            // Create layer based on index
            if (index === 0)
                layer = display.getDefaultLayer();
            else if (index > 0)
                layer = display.createLayer();
            else
                layer = display.createBuffer();

            // Add new layer
            layers[index] = layer;

        }

        return layer;

    };

    function getParser(index) {

        var parser = parsers[index];

        // If parser not yet created, create it, and tie to the
        // oninstruction handler of the tunnel.
        if (parser == null) {
            parser = parsers[index] = new Parser();
            parser.oninstruction = tunnel.oninstruction;
        }

        return parser;

    }

    /**
     * Handlers for all defined layer properties.
     * @private
     */
    var layerPropertyHandlers = {

        "miter-limit": function(layer, value) {
            display.setMiterLimit(layer, parseFloat(value));
        }

    };

    /**
     * Handlers for all instruction opcodes receivable by a Guacamole protocol
     * client.
     * @private
     */
    var instructionHandlers = {

        "ack": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var reason = parameters[1];
            var code = parseInt(parameters[2]);

            // Get stream
            var stream = output_streams[stream_index];
            if (stream) {

                // Signal ack if handler defined
                if (stream.onack)
                    stream.onack(new Status$1(code, reason));

                // If code is an error, invalidate stream
                if (code >= 0x0100) {
                    stream_indices.free(stream_index);
                    delete output_streams[stream_index];
                }

            }

        },

        "arc": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var x = parseInt(parameters[1]);
            var y = parseInt(parameters[2]);
            var radius = parseInt(parameters[3]);
            var startAngle = parseFloat(parameters[4]);
            var endAngle = parseFloat(parameters[5]);
            var negative = parseInt(parameters[6]);

            display.arc(layer, x, y, radius, startAngle, endAngle, negative != 0);

        },

        "audio": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var mimetype = parameters[1];

            // Create stream
            var stream = streams[stream_index] =
                    new InputStream(guac_client, stream_index);

            // Get player instance via callback
            var audioPlayer = null;
            if (guac_client.onaudio)
                audioPlayer = guac_client.onaudio(stream, mimetype);

            // If unsuccessful, try to use a default implementation
            if (!audioPlayer)
                audioPlayer = AudioPlayer$1.getInstance(stream, mimetype);

            // If we have successfully retrieved an audio player, send success response
            if (audioPlayer) {
                audioPlayers[stream_index] = audioPlayer;
                guac_client.sendAck(stream_index, "OK", 0x0000);
            }

            // Otherwise, mimetype must be unsupported
            else
                guac_client.sendAck(stream_index, "BAD TYPE", 0x030F);

        },

        "blob": function(parameters) {

            // Get stream
            var stream_index = parseInt(parameters[0]);
            var data = parameters[1];
            var stream = streams[stream_index];

            // Write data
            if (stream && stream.onblob)
                stream.onblob(data);

        },

        "body" : function handleBody(parameters) {

            // Get object
            var objectIndex = parseInt(parameters[0]);
            var object = objects[objectIndex];

            var streamIndex = parseInt(parameters[1]);
            var mimetype = parameters[2];
            var name = parameters[3];

            // Create stream if handler defined
            if (object && object.onbody) {
                var stream = streams[streamIndex] = new InputStream(guac_client, streamIndex);
                object.onbody(stream, mimetype, name);
            }

            // Otherwise, unsupported
            else
                guac_client.sendAck(streamIndex, "Receipt of body unsupported", 0x0100);

        },

        "cfill": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var r = parseInt(parameters[2]);
            var g = parseInt(parameters[3]);
            var b = parseInt(parameters[4]);
            var a = parseInt(parameters[5]);

            display.setChannelMask(layer, channelMask);
            display.fillColor(layer, r, g, b, a);

        },

        "clip": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.clip(layer);

        },

        "clipboard": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var mimetype = parameters[1];

            // Create stream
            if (guac_client.onclipboard) {
                var stream = streams[stream_index] = new InputStream(guac_client, stream_index);
                guac_client.onclipboard(stream, mimetype);
            }

            // Otherwise, unsupported
            else
                guac_client.sendAck(stream_index, "Clipboard unsupported", 0x0100);

        },

        "close": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.close(layer);

        },

        "copy": function(parameters) {

            var srcL = getLayer(parseInt(parameters[0]));
            var srcX = parseInt(parameters[1]);
            var srcY = parseInt(parameters[2]);
            var srcWidth = parseInt(parameters[3]);
            var srcHeight = parseInt(parameters[4]);
            var channelMask = parseInt(parameters[5]);
            var dstL = getLayer(parseInt(parameters[6]));
            var dstX = parseInt(parameters[7]);
            var dstY = parseInt(parameters[8]);

            display.setChannelMask(dstL, channelMask);
            display.copy(srcL, srcX, srcY, srcWidth, srcHeight,
                         dstL, dstX, dstY);

        },

        "cstroke": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var cap = lineCap[parseInt(parameters[2])];
            var join = lineJoin[parseInt(parameters[3])];
            var thickness = parseInt(parameters[4]);
            var r = parseInt(parameters[5]);
            var g = parseInt(parameters[6]);
            var b = parseInt(parameters[7]);
            var a = parseInt(parameters[8]);

            display.setChannelMask(layer, channelMask);
            display.strokeColor(layer, cap, join, thickness, r, g, b, a);

        },

        "cursor": function(parameters) {

            var cursorHotspotX = parseInt(parameters[0]);
            var cursorHotspotY = parseInt(parameters[1]);
            var srcL = getLayer(parseInt(parameters[2]));
            var srcX = parseInt(parameters[3]);
            var srcY = parseInt(parameters[4]);
            var srcWidth = parseInt(parameters[5]);
            var srcHeight = parseInt(parameters[6]);

            display.setCursor(cursorHotspotX, cursorHotspotY,
                              srcL, srcX, srcY, srcWidth, srcHeight);

        },

        "curve": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var cp1x = parseInt(parameters[1]);
            var cp1y = parseInt(parameters[2]);
            var cp2x = parseInt(parameters[3]);
            var cp2y = parseInt(parameters[4]);
            var x = parseInt(parameters[5]);
            var y = parseInt(parameters[6]);

            display.curveTo(layer, cp1x, cp1y, cp2x, cp2y, x, y);

        },

        "dispose": function(parameters) {

            var layer_index = parseInt(parameters[0]);

            // If visible layer, remove from parent
            if (layer_index > 0) {

                // Remove from parent
                var layer = getLayer(layer_index);
                layer.dispose();

                // Delete reference
                delete layers[layer_index];

            }

            // If buffer, just delete reference
            else if (layer_index < 0)
                delete layers[layer_index];

            // Attempting to dispose the root layer currently has no effect.

        },

        "distort": function(parameters) {

            var layer_index = parseInt(parameters[0]);
            var a = parseFloat(parameters[1]);
            var b = parseFloat(parameters[2]);
            var c = parseFloat(parameters[3]);
            var d = parseFloat(parameters[4]);
            var e = parseFloat(parameters[5]);
            var f = parseFloat(parameters[6]);

            // Only valid for visible layers (not buffers)
            if (layer_index >= 0) {
                var layer = getLayer(layer_index);
                layer.distort(a, b, c, d, e, f);
            }

        },

        "error": function(parameters) {

            var reason = parameters[0];
            var code = parseInt(parameters[1]);

            // Call handler if defined
            if (guac_client.onerror)
                guac_client.onerror(new Status$1(code, reason));

            guac_client.disconnect();

        },

        "end": function(parameters) {

            var stream_index = parseInt(parameters[0]);

            // Get stream
            var stream = streams[stream_index];
            if (stream) {

                // Signal end of stream if handler defined
                if (stream.onend)
                    stream.onend();

                // Invalidate stream
                delete streams[stream_index];

            }

        },

        "file": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var mimetype = parameters[1];
            var filename = parameters[2];

            // Create stream
            if (guac_client.onfile) {
                var stream = streams[stream_index] = new InputStream(guac_client, stream_index);
                guac_client.onfile(stream, mimetype, filename);
            }

            // Otherwise, unsupported
            else
                guac_client.sendAck(stream_index, "File transfer unsupported", 0x0100);

        },

        "filesystem" : function handleFilesystem(parameters) {

            var objectIndex = parseInt(parameters[0]);
            var name = parameters[1];

            // Create object, if supported
            if (guac_client.onfilesystem) {
                var object = objects[objectIndex] = new guacamoleObject(guac_client, objectIndex);
                guac_client.onfilesystem(object, name);
            }

            // If unsupported, simply ignore the availability of the filesystem

        },

        "identity": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.setTransform(layer, 1, 0, 0, 1, 0, 0);

        },

        "img": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var channelMask = parseInt(parameters[1]);
            var layer = getLayer(parseInt(parameters[2]));
            var mimetype = parameters[3];
            var x = parseInt(parameters[4]);
            var y = parseInt(parameters[5]);

            // Create stream
            var stream = streams[stream_index] = new InputStream(guac_client, stream_index);
            var reader = new DataURIReader(stream, mimetype);

            // Draw image when stream is complete
            reader.onend = function drawImageBlob() {
                display.setChannelMask(layer, channelMask);
                display.draw(layer, x, y, reader.getURI());
            };

        },

        "jpeg": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var x = parseInt(parameters[2]);
            var y = parseInt(parameters[3]);
            var data = parameters[4];

            display.setChannelMask(layer, channelMask);
            display.draw(layer, x, y, "data:image/jpeg;base64," + data);

        },

        "lfill": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var srcLayer = getLayer(parseInt(parameters[2]));

            display.setChannelMask(layer, channelMask);
            display.fillLayer(layer, srcLayer);

        },

        "line": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var x = parseInt(parameters[1]);
            var y = parseInt(parameters[2]);

            display.lineTo(layer, x, y);

        },

        "lstroke": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var srcLayer = getLayer(parseInt(parameters[2]));

            display.setChannelMask(layer, channelMask);
            display.strokeLayer(layer, srcLayer);

        },

        "move": function(parameters) {

            var layer_index = parseInt(parameters[0]);
            var parent_index = parseInt(parameters[1]);
            var x = parseInt(parameters[2]);
            var y = parseInt(parameters[3]);
            var z = parseInt(parameters[4]);

            // Only valid for non-default layers
            if (layer_index > 0 && parent_index >= 0) {
                var layer = getLayer(layer_index);
                var parent = getLayer(parent_index);
                layer.move(parent, x, y, z);
            }

        },

        "name": function(parameters) {
            if (guac_client.onname) guac_client.onname(parameters[0]);
        },

        "nest": function(parameters) {
            var parser = getParser(parseInt(parameters[0]));
            parser.receive(parameters[1]);
        },

        "pipe": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var mimetype = parameters[1];
            var name = parameters[2];

            // Create stream
            if (guac_client.onpipe) {
                var stream = streams[stream_index] = new InputStream(guac_client, stream_index);
                guac_client.onpipe(stream, mimetype, name);
            }

            // Otherwise, unsupported
            else
                guac_client.sendAck(stream_index, "Named pipes unsupported", 0x0100);

        },

        "png": function(parameters) {

            var channelMask = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var x = parseInt(parameters[2]);
            var y = parseInt(parameters[3]);
            var data = parameters[4];

            display.setChannelMask(layer, channelMask);
            display.draw(layer, x, y, "data:image/png;base64," + data);

        },

        "pop": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.pop(layer);

        },

        "push": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.push(layer);

        },

        "rect": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var x = parseInt(parameters[1]);
            var y = parseInt(parameters[2]);
            var w = parseInt(parameters[3]);
            var h = parseInt(parameters[4]);

            display.rect(layer, x, y, w, h);

        },

        "reset": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));

            display.reset(layer);

        },

        "set": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var name = parameters[1];
            var value = parameters[2];

            // Call property handler if defined
            var handler = layerPropertyHandlers[name];
            if (handler)
                handler(layer, value);

        },

        "shade": function(parameters) {

            var layer_index = parseInt(parameters[0]);
            var a = parseInt(parameters[1]);

            // Only valid for visible layers (not buffers)
            if (layer_index >= 0) {
                var layer = getLayer(layer_index);
                layer.shade(a);
            }

        },

        "size": function(parameters) {

            var layer_index = parseInt(parameters[0]);
            var layer = getLayer(layer_index);
            var width = parseInt(parameters[1]);
            var height = parseInt(parameters[2]);

            display.resize(layer, width, height);

        },

        "start": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var x = parseInt(parameters[1]);
            var y = parseInt(parameters[2]);

            display.moveTo(layer, x, y);

        },

        "sync": function(parameters) {

            var timestamp = parseInt(parameters[0]);

            // Flush display, send sync when done
            display.flush(function displaySyncComplete() {

                // Synchronize all audio players
                for (var index in audioPlayers) {
                    var audioPlayer = audioPlayers[index];
                    if (audioPlayer)
                        audioPlayer.sync();
                }

                // Send sync response to server
                if (timestamp !== currentTimestamp) {
                    tunnel.sendMessage("sync", timestamp);
                    currentTimestamp = timestamp;
                }

            });

            // If received first update, no longer waiting.
            if (currentState === STATE_WAITING)
                setState(STATE_CONNECTED);

            // Call sync handler if defined
            if (guac_client.onsync)
                guac_client.onsync(timestamp);

        },

        "transfer": function(parameters) {

            var srcL = getLayer(parseInt(parameters[0]));
            var srcX = parseInt(parameters[1]);
            var srcY = parseInt(parameters[2]);
            var srcWidth = parseInt(parameters[3]);
            var srcHeight = parseInt(parameters[4]);
            var function_index = parseInt(parameters[5]);
            var dstL = getLayer(parseInt(parameters[6]));
            var dstX = parseInt(parameters[7]);
            var dstY = parseInt(parameters[8]);

            /* SRC */
            if (function_index === 0x3)
                display.put(srcL, srcX, srcY, srcWidth, srcHeight,
                    dstL, dstX, dstY);

            /* Anything else that isn't a NO-OP */
            else if (function_index !== 0x5)
                display.transfer(srcL, srcX, srcY, srcWidth, srcHeight,
                    dstL, dstX, dstY, Client.DefaultTransferFunction[function_index]);

        },

        "transform": function(parameters) {

            var layer = getLayer(parseInt(parameters[0]));
            var a = parseFloat(parameters[1]);
            var b = parseFloat(parameters[2]);
            var c = parseFloat(parameters[3]);
            var d = parseFloat(parameters[4]);
            var e = parseFloat(parameters[5]);
            var f = parseFloat(parameters[6]);

            display.transform(layer, a, b, c, d, e, f);

        },

        "undefine" : function handleUndefine(parameters) {

            // Get object
            var objectIndex = parseInt(parameters[0]);
            var object = objects[objectIndex];

            // Signal end of object definition
            if (object && object.onundefine)
                object.onundefine();

        },

        "video": function(parameters) {

            var stream_index = parseInt(parameters[0]);
            var layer = getLayer(parseInt(parameters[1]));
            var mimetype = parameters[2];

            // Create stream
            var stream = streams[stream_index] =
                    new InputStream(guac_client, stream_index);

            // Get player instance via callback
            var videoPlayer = null;
            if (guac_client.onvideo)
                videoPlayer = guac_client.onvideo(stream, layer, mimetype);

            // If unsuccessful, try to use a default implementation
            if (!videoPlayer)
                videoPlayer = VideoPlayer.getInstance(stream, layer, mimetype);

            // If we have successfully retrieved an video player, send success response
            if (videoPlayer) {
                guac_client.sendAck(stream_index, "OK", 0x0000);
            }

            // Otherwise, mimetype must be unsupported
            else
                guac_client.sendAck(stream_index, "BAD TYPE", 0x030F);

        }

    };

    tunnel.oninstruction = function(opcode, parameters) {

        var handler = instructionHandlers[opcode];
        if (handler)
            handler(parameters);

    };

    /**
     * Sends a disconnect instruction to the server and closes the tunnel.
     */
    this.disconnect = function() {

        // Only attempt disconnection not disconnected.
        if (currentState != STATE_DISCONNECTED
                && currentState != STATE_DISCONNECTING) {

            setState(STATE_DISCONNECTING);

            // Stop ping
            if (pingInterval)
                window.clearInterval(pingInterval);

            // Send disconnect message and disconnect
            tunnel.sendMessage("disconnect");
            tunnel.disconnect();
            setState(STATE_DISCONNECTED);

        }

    };

    /**
     * Connects the underlying tunnel of this Client, passing the
     * given arbitrary data to the tunnel during the connection process.
     *
     * @param data Arbitrary connection data to be sent to the underlying
     *             tunnel during the connection process.
     * @throws {Status} If an error occurs during connection.
     */
    this.connect = function(data) {

        setState(STATE_CONNECTING);

        try {
            tunnel.connect(data);
        }
        catch (status) {
            setState(STATE_IDLE);
            throw status;
        }

        // Ping every 5 seconds (ensure connection alive)
        pingInterval = window.setInterval(function() {
            tunnel.sendMessage("sync", currentTimestamp);
        }, 5000);

        setState(STATE_WAITING);
    };

}
/**
 * Map of all Guacamole binary raster operations to transfer functions.
 * @private
 */
Client.DefaultTransferFunction = {

    /* BLACK */
    0x0: function (src, dst) {
        dst.red = dst.green = dst.blue = 0x00;
    },

    /* WHITE */
    0xF: function (src, dst) {
        dst.red = dst.green = dst.blue = 0xFF;
    },

    /* SRC */
    0x3: function (src, dst) {
        dst.red   = src.red;
        dst.green = src.green;
        dst.blue  = src.blue;
        dst.alpha = src.alpha;
    },

    /* DEST (no-op) */
    0x5: function (src, dst) {
        // Do nothing
    },

    /* Invert SRC */
    0xC: function (src, dst) {
        dst.red   = 0xFF & ~src.red;
        dst.green = 0xFF & ~src.green;
        dst.blue  = 0xFF & ~src.blue;
        dst.alpha =  src.alpha;
    },

    /* Invert DEST */
    0xA: function (src, dst) {
        dst.red   = 0xFF & ~dst.red;
        dst.green = 0xFF & ~dst.green;
        dst.blue  = 0xFF & ~dst.blue;
    },

    /* AND */
    0x1: function (src, dst) {
        dst.red   =  ( src.red   &  dst.red);
        dst.green =  ( src.green &  dst.green);
        dst.blue  =  ( src.blue  &  dst.blue);
    },

    /* NAND */
    0xE: function (src, dst) {
        dst.red   = 0xFF & ~( src.red   &  dst.red);
        dst.green = 0xFF & ~( src.green &  dst.green);
        dst.blue  = 0xFF & ~( src.blue  &  dst.blue);
    },

    /* OR */
    0x7: function (src, dst) {
        dst.red   =  ( src.red   |  dst.red);
        dst.green =  ( src.green |  dst.green);
        dst.blue  =  ( src.blue  |  dst.blue);
    },

    /* NOR */
    0x8: function (src, dst) {
        dst.red   = 0xFF & ~( src.red   |  dst.red);
        dst.green = 0xFF & ~( src.green |  dst.green);
        dst.blue  = 0xFF & ~( src.blue  |  dst.blue);
    },

    /* XOR */
    0x6: function (src, dst) {
        dst.red   =  ( src.red   ^  dst.red);
        dst.green =  ( src.green ^  dst.green);
        dst.blue  =  ( src.blue  ^  dst.blue);
    },

    /* XNOR */
    0x9: function (src, dst) {
        dst.red   = 0xFF & ~( src.red   ^  dst.red);
        dst.green = 0xFF & ~( src.green ^  dst.green);
        dst.blue  = 0xFF & ~( src.blue  ^  dst.blue);
    },

    /* AND inverted source */
    0x4: function (src, dst) {
        dst.red   =  0xFF & (~src.red   &  dst.red);
        dst.green =  0xFF & (~src.green &  dst.green);
        dst.blue  =  0xFF & (~src.blue  &  dst.blue);
    },

    /* OR inverted source */
    0xD: function (src, dst) {
        dst.red   =  0xFF & (~src.red   |  dst.red);
        dst.green =  0xFF & (~src.green |  dst.green);
        dst.blue  =  0xFF & (~src.blue  |  dst.blue);
    },

    /* AND inverted destination */
    0x2: function (src, dst) {
        dst.red   =  0xFF & ( src.red   & ~dst.red);
        dst.green =  0xFF & ( src.green & ~dst.green);
        dst.blue  =  0xFF & ( src.blue  & ~dst.blue);
    },

    /* OR inverted destination */
    0xB: function (src, dst) {
        dst.red   =  0xFF & ( src.red   | ~dst.red);
        dst.green =  0xFF & ( src.green | ~dst.green);
        dst.blue  =  0xFF & ( src.blue  | ~dst.blue);
    }

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Guacamole Tunnel implemented over HTTP via XMLHttpRequest.
 *
 * @constructor
 * @augments Tunnel
 *
 * @param {String} tunnelURL
 *     The URL of the HTTP tunneling service.
 *
 * @param {Boolean} [crossDomain=false]
 *     Whether tunnel requests will be cross-domain, and thus must use CORS
 *     mechanisms and headers. By default, it is assumed that tunnel requests
 *     will be made to the same domain.
 */
function HTTPTunnel(tunnelURL, crossDomain) {

    /**
     * Reference to this HTTP tunnel.
     * @private
     */
    var tunnel = this;

    var tunnel_uuid;

    var TUNNEL_CONNECT = tunnelURL + "?connect";
    var TUNNEL_READ    = tunnelURL + "?read:";
    var TUNNEL_WRITE   = tunnelURL + "?write:";

    var POLLING_ENABLED     = 1;
    var POLLING_DISABLED    = 0;

    // Default to polling - will be turned off automatically if not needed
    var pollingMode = POLLING_ENABLED;

    var sendingMessages = false;
    var outputMessageBuffer = "";

    // If requests are expected to be cross-domain, the cookie that the HTTP
    // tunnel depends on will only be sent if withCredentials is true
    var withCredentials = !!crossDomain;

    /**
     * The current receive timeout ID, if any.
     * @private
     */
    var receive_timeout = null;

    /**
     * Initiates a timeout which, if data is not received, causes the tunnel
     * to close with an error.
     *
     * @private
     */
    function reset_timeout() {

        // Get rid of old timeout (if any)
        window.clearTimeout(receive_timeout);

        // Set new timeout
        receive_timeout = window.setTimeout(function () {
            close_tunnel(new Status(Status.Code.UPSTREAM_TIMEOUT, "Server timeout."));
        }, tunnel.receiveTimeout);

    }

    /**
     * Closes this tunnel, signaling the given status and corresponding
     * message, which will be sent to the onerror handler if the status is
     * an error status.
     *
     * @private
     * @param {Status} status The status causing the connection to
     *                                  close;
     */
    function close_tunnel(status) {

        // Ignore if already closed
        if (tunnel.state === Tunnel.State.CLOSED)
            return;

        // If connection closed abnormally, signal error.
        if (status.code !== Status.Code.SUCCESS && tunnel.onerror) {

            // Ignore RESOURCE_NOT_FOUND if we've already connected, as that
            // only signals end-of-stream for the HTTP tunnel.
            if (tunnel.state === Tunnel.State.CONNECTING
                    || status.code !== Status.Code.RESOURCE_NOT_FOUND)
                tunnel.onerror(status);

        }

        // Mark as closed
        tunnel.state = Tunnel.State.CLOSED;

        // Reset output message buffer
        sendingMessages = false;

        if (tunnel.onstatechange)
            tunnel.onstatechange(tunnel.state);

    }


    this.sendMessage = function() {

        // Do not attempt to send messages if not connected
        if (tunnel.state !== Tunnel.State.OPEN)
            return;

        // Do not attempt to send empty messages
        if (arguments.length === 0)
            return;

        /**
         * Converts the given value to a length/string pair for use as an
         * element in a Guacamole instruction.
         *
         * @private
         * @param value The value to convert.
         * @return {String} The converted value.
         */
        function getElement(value) {
            var string = new String(value);
            return string.length + "." + string;
        }

        // Initialized message with first element
        var message = getElement(arguments[0]);

        // Append remaining elements
        for (var i=1; i<arguments.length; i++)
            message += "," + getElement(arguments[i]);

        // Final terminator
        message += ";";

        // Add message to buffer
        outputMessageBuffer += message;

        // Send if not currently sending
        if (!sendingMessages)
            sendPendingMessages();

    };

    function sendPendingMessages() {

        // Do not attempt to send messages if not connected
        if (tunnel.state !== Tunnel.State.OPEN)
            return;

        if (outputMessageBuffer.length > 0) {

            sendingMessages = true;

            var message_xmlhttprequest = new XMLHttpRequest();
            message_xmlhttprequest.open("POST", TUNNEL_WRITE + tunnel_uuid);
            message_xmlhttprequest.withCredentials = withCredentials;
            message_xmlhttprequest.setRequestHeader("Content-type", "application/x-www-form-urlencoded; charset=UTF-8");

            // Once response received, send next queued event.
            message_xmlhttprequest.onreadystatechange = function() {
                if (message_xmlhttprequest.readyState === 4) {

                    // If an error occurs during send, handle it
                    if (message_xmlhttprequest.status !== 200)
                        handleHTTPTunnelError(message_xmlhttprequest);

                    // Otherwise, continue the send loop
                    else
                        sendPendingMessages();

                }
            };

            message_xmlhttprequest.send(outputMessageBuffer);
            outputMessageBuffer = ""; // Clear buffer

        }
        else
            sendingMessages = false;

    }

    function handleHTTPTunnelError(xmlhttprequest) {

        var code = parseInt(xmlhttprequest.getResponseHeader("Guacamole-Status-Code"));
        var message = xmlhttprequest.getResponseHeader("Guacamole-Error-Message");

        close_tunnel(new Status(code, message));

    }

    function handleResponse(xmlhttprequest) {

        var interval = null;
        var nextRequest = null;

        var dataUpdateEvents = 0;

        // The location of the last element's terminator
        var elementEnd = -1;

        // Where to start the next length search or the next element
        var startIndex = 0;

        // Parsed elements
        var elements = new Array();

        function parseResponse() {

            // Do not handle responses if not connected
            if (tunnel.state !== Tunnel.State.OPEN) {

                // Clean up interval if polling
                if (interval !== null)
                    clearInterval(interval);

                return;
            }

            // Do not parse response yet if not ready
            if (xmlhttprequest.readyState < 2) return;

            // Attempt to read status
            var status;
            try { status = xmlhttprequest.status; }

            // If status could not be read, assume successful.
            catch (e) { status = 200; }

            // Start next request as soon as possible IF request was successful
            if (!nextRequest && status === 200)
                nextRequest = makeRequest();

            // Parse stream when data is received and when complete.
            if (xmlhttprequest.readyState === 3 ||
                xmlhttprequest.readyState === 4) {

                reset_timeout();

                // Also poll every 30ms (some browsers don't repeatedly call onreadystatechange for new data)
                if (pollingMode === POLLING_ENABLED) {
                    if (xmlhttprequest.readyState === 3 && !interval)
                        interval = setInterval(parseResponse, 30);
                    else if (xmlhttprequest.readyState === 4 && !interval)
                        clearInterval(interval);
                }

                // If canceled, stop transfer
                if (xmlhttprequest.status === 0) {
                    tunnel.disconnect();
                    return;
                }

                // Halt on error during request
                else if (xmlhttprequest.status !== 200) {
                    handleHTTPTunnelError(xmlhttprequest);
                    return;
                }

                // Attempt to read in-progress data
                var current;
                try { current = xmlhttprequest.responseText; }

                // Do not attempt to parse if data could not be read
                catch (e) { return; }

                // While search is within currently received data
                while (elementEnd < current.length) {

                    // If we are waiting for element data
                    if (elementEnd >= startIndex) {

                        // We now have enough data for the element. Parse.
                        var element = current.substring(startIndex, elementEnd);
                        var terminator = current.substring(elementEnd, elementEnd+1);

                        // Add element to array
                        elements.push(element);

                        // If last element, handle instruction
                        if (terminator === ";") {

                            // Get opcode
                            var opcode = elements.shift();

                            // Call instruction handler.
                            if (tunnel.oninstruction)
                                tunnel.oninstruction(opcode, elements);

                            // Clear elements
                            elements.length = 0;

                        }

                        // Start searching for length at character after
                        // element terminator
                        startIndex = elementEnd + 1;

                    }

                    // Search for end of length
                    var lengthEnd = current.indexOf(".", startIndex);
                    if (lengthEnd !== -1) {

                        // Parse length
                        var length = parseInt(current.substring(elementEnd+1, lengthEnd));

                        // If we're done parsing, handle the next response.
                        if (length === 0) {

                            // Clean up interval if polling
                            if (!interval)
                                clearInterval(interval);

                            // Clean up object
                            xmlhttprequest.onreadystatechange = null;
                            xmlhttprequest.abort();

                            // Start handling next request
                            if (nextRequest)
                                handleResponse(nextRequest);

                            // Done parsing
                            break;

                        }

                        // Calculate start of element
                        startIndex = lengthEnd + 1;

                        // Calculate location of element terminator
                        elementEnd = startIndex + length;

                    }

                    // If no period yet, continue search when more data
                    // is received
                    else {
                        startIndex = current.length;
                        break;
                    }

                } // end parse loop

            }

        }

        // If response polling enabled, attempt to detect if still
        // necessary (via wrapping parseResponse())
        if (pollingMode === POLLING_ENABLED) {
            xmlhttprequest.onreadystatechange = function() {

                // If we receive two or more readyState==3 events,
                // there is no need to poll.
                if (xmlhttprequest.readyState === 3) {
                    dataUpdateEvents++;
                    if (dataUpdateEvents >= 2) {
                        pollingMode = POLLING_DISABLED;
                        xmlhttprequest.onreadystatechange = parseResponse;
                    }
                }

                parseResponse();
            };
        }

        // Otherwise, just parse
        else
            xmlhttprequest.onreadystatechange = parseResponse;

        parseResponse();

    }

    /**
     * Arbitrary integer, unique for each tunnel read request.
     * @private
     */
    var request_id = 0;

    function makeRequest() {

        // Make request, increment request ID
        var xmlhttprequest = new XMLHttpRequest();
        xmlhttprequest.open("GET", TUNNEL_READ + tunnel_uuid + ":" + (request_id++));
        xmlhttprequest.withCredentials = withCredentials;
        xmlhttprequest.send(null);

        return xmlhttprequest;

    }

    this.connect = function(data) {

        // Start waiting for connect
        reset_timeout();

        // Start tunnel and connect
        var connect_xmlhttprequest = new XMLHttpRequest();
        connect_xmlhttprequest.onreadystatechange = function() {

            if (connect_xmlhttprequest.readyState !== 4)
                return;

            // If failure, throw error
            if (connect_xmlhttprequest.status !== 200) {
                handleHTTPTunnelError(connect_xmlhttprequest);
                return;
            }

            reset_timeout();

            // Get UUID from response
            tunnel_uuid = connect_xmlhttprequest.responseText;

            tunnel.state = Tunnel.State.OPEN;
            if (tunnel.onstatechange)
                tunnel.onstatechange(tunnel.state);

            // Start reading data
            handleResponse(makeRequest());

        };

        connect_xmlhttprequest.open("POST", TUNNEL_CONNECT, true);
        connect_xmlhttprequest.withCredentials = withCredentials;
        connect_xmlhttprequest.setRequestHeader("Content-type", "application/x-www-form-urlencoded; charset=UTF-8");
        connect_xmlhttprequest.send(data);

    };

    this.disconnect = function() {
        close_tunnel(new Status(Status.Code.SUCCESS, "Manually closed."));
    };

}
HTTPTunnel.prototype = new Tunnel();

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A reader which automatically handles the given input stream, returning
 * strictly text data. Note that this object will overwrite any installed event
 * handlers on the given InputStream.
 *
 * @constructor
 * @param {InputStream} stream The stream that data will be read
 *                                       from.
 */
function StringReader(stream) {

    /**
     * Reference to this InputStream.
     * @private
     */
    var guac_reader = this;

    /**
     * Wrapped ArrayBufferReader.
     * @private
     * @type {ArrayBufferReader}
     */
    var array_reader = new ArrayBufferReader(stream);

    /**
     * The number of bytes remaining for the current codepoint.
     *
     * @private
     * @type {Number}
     */
    var bytes_remaining = 0;

    /**
     * The current codepoint value, as calculated from bytes read so far.
     *
     * @private
     * @type {Number}
     */
    var codepoint = 0;

    /**
     * Decodes the given UTF-8 data into a Unicode string. The data may end in
     * the middle of a multibyte character.
     *
     * @private
     * @param {ArrayBuffer} buffer Arbitrary UTF-8 data.
     * @return {String} A decoded Unicode string.
     */
    function __decode_utf8(buffer) {

        var text = "";

        var bytes = new Uint8Array(buffer);
        for (var i=0; i<bytes.length; i++) {

            // Get current byte
            var value = bytes[i];

            // Start new codepoint if nothing yet read
            if (bytes_remaining === 0) {

                // 1 byte (0xxxxxxx)
                if ((value | 0x7F) === 0x7F)
                    text += String.fromCharCode(value);

                // 2 byte (110xxxxx)
                else if ((value | 0x1F) === 0xDF) {
                    codepoint = value & 0x1F;
                    bytes_remaining = 1;
                }

                // 3 byte (1110xxxx)
                else if ((value | 0x0F )=== 0xEF) {
                    codepoint = value & 0x0F;
                    bytes_remaining = 2;
                }

                // 4 byte (11110xxx)
                else if ((value | 0x07) === 0xF7) {
                    codepoint = value & 0x07;
                    bytes_remaining = 3;
                }

                // Invalid byte
                else
                    text += "\uFFFD";

            }

            // Continue existing codepoint (10xxxxxx)
            else if ((value | 0x3F) === 0xBF) {

                codepoint = (codepoint << 6) | (value & 0x3F);
                bytes_remaining--;

                // Write codepoint if finished
                if (bytes_remaining === 0)
                    text += String.fromCharCode(codepoint);

            }

            // Invalid byte
            else {
                bytes_remaining = 0;
                text += "\uFFFD";
            }

        }

        return text;

    }

    // Receive blobs as strings
    array_reader.ondata = function(buffer) {

        // Decode UTF-8
        var text = __decode_utf8(buffer);

        // Call handler, if present
        if (guac_reader.ontext)
            guac_reader.ontext(text);

    };

    // Simply call onend when end received
    array_reader.onend = function() {
        if (guac_reader.onend)
            guac_reader.onend();
    };

    /**
     * Fired once for every blob of text data received.
     *
     * @event
     * @param {String} text The data packet received.
     */
    this.ontext = null;

    /**
     * Fired once this stream is finished and no further data will be written.
     * @event
     */
    this.onend = null;

}

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * A reader which automatically handles the given input stream, assembling all
 * received blobs into a JavaScript object by appending them to each other, in
 * order, and decoding the result as JSON. Note that this object will overwrite
 * any installed event handlers on the given InputStream.
 *
 * @constructor
 * @param {InputStream} stream
 *     The stream that JSON will be read from.
 */
function guacamoleJSONReader(stream) {

    /**
     * Reference to this JSONReader.
     *
     * @private
     * @type {JSONReader}
     */
    var guacReader = this;

    /**
     * Wrapped StringReader.
     *
     * @private
     * @type {StringReader}
     */
    var stringReader = new StringReader(stream);

    /**
     * All JSON read thus far.
     *
     * @private
     * @type {String}
     */
    var json = '';

    /**
     * Returns the current length of this JSONReader, in characters.
     *
     * @return {Number}
     *     The current length of this JSONReader.
     */
    this.getLength = function getLength() {
        return json.length;
    };

    /**
     * Returns the contents of this JSONReader as a JavaScript
     * object.
     *
     * @return {Object}
     *     The contents of this JSONReader, as parsed from the JSON
     *     contents of the input stream.
     */
    this.getJSON = function getJSON() {
        return JSON.parse(json);
    };

    // Append all received text
    stringReader.ontext = function ontext(text) {

        // Append received text
        json += text;

        // Call handler, if present
        if (guacReader.onprogress)
            guacReader.onprogress(text.length);

    };

    // Simply call onend when end received
    stringReader.onend = function onend() {
        if (guacReader.onend)
            guacReader.onend();
    };

    /**
     * Fired once for every blob of data received.
     *
     * @event
     * @param {Number} length
     *     The number of characters received.
     */
    this.onprogress = null;

    /**
     * Fired once this stream is finished and no further data will be written.
     *
     * @event
     */
    this.onend = null;

}

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Provides cross-browser and cross-keyboard keyboard for a specific element.
 * Browser and keyboard layout variation is abstracted away, providing events
 * which represent keys as their corresponding X11 keysym.
 *
 * @constructor
 * @param {Element} element The Element to use to provide keyboard events.
 */
function Keyboard$1(element) {

    /**
     * Reference to this Keyboard.
     * @private
     */
    var guac_keyboard = this;

    /**
     * Fired whenever the user presses a key with the element associated
     * with this Keyboard in focus.
     *
     * @event
     * @param {Number} keysym The keysym of the key being pressed.
     * @return {Boolean} true if the key event should be allowed through to the
     *                   browser, false otherwise.
     */
    this.onkeydown = null;

    /**
     * Fired whenever the user releases a key with the element associated
     * with this Keyboard in focus.
     *
     * @event
     * @param {Number} keysym The keysym of the key being released.
     */
    this.onkeyup = null;

    /**
     * A key event having a corresponding timestamp. This event is non-specific.
     * Its subclasses should be used instead when recording specific key
     * events.
     *
     * @private
     * @constructor
     */
    var KeyEvent = function() {

        /**
         * Reference to this key event.
         */
        var key_event = this;

        /**
         * An arbitrary timestamp in milliseconds, indicating this event's
         * position in time relative to other events.
         *
         * @type {Number}
         */
        this.timestamp = new Date().getTime();

        /**
         * Whether the default action of this key event should be prevented.
         *
         * @type {Boolean}
         */
        this.defaultPrevented = false;

        /**
         * The keysym of the key associated with this key event, as determined
         * by a best-effort guess using available event properties and keyboard
         * state.
         *
         * @type {Number}
         */
        this.keysym = null;

        /**
         * Whether the keysym value of this key event is known to be reliable.
         * If false, the keysym may still be valid, but it's only a best guess,
         * and future key events may be a better source of information.
         *
         * @type {Boolean}
         */
        this.reliable = false;

        /**
         * Returns the number of milliseconds elapsed since this event was
         * received.
         *
         * @return {Number} The number of milliseconds elapsed since this
         *                  event was received.
         */
        this.getAge = function() {
            return new Date().getTime() - key_event.timestamp;
        };

    };

    /**
     * Information related to the pressing of a key, which need not be a key
     * associated with a printable character. The presence or absence of any
     * information within this object is browser-dependent.
     *
     * @private
     * @constructor
     * @augments Keyboard.KeyEvent
     * @param {Number} keyCode The JavaScript key code of the key pressed.
     * @param {String} keyIdentifier The legacy DOM3 "keyIdentifier" of the key
     *                               pressed, as defined at:
     *                               http://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#events-Events-KeyboardEvent
     * @param {String} key The standard name of the key pressed, as defined at:
     *                     http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     * @param {Number} location The location on the keyboard corresponding to
     *                          the key pressed, as defined at:
     *                          http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     */
    var KeydownEvent = function(keyCode, keyIdentifier, key, location) {

        // We extend KeyEvent
        KeyEvent.apply(this);

        /**
         * The JavaScript key code of the key pressed.
         *
         * @type {Number}
         */
        this.keyCode = keyCode;

        /**
         * The legacy DOM3 "keyIdentifier" of the key pressed, as defined at:
         * http://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#events-Events-KeyboardEvent
         *
         * @type {String}
         */
        this.keyIdentifier = keyIdentifier;

        /**
         * The standard name of the key pressed, as defined at:
         * http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
         *
         * @type {String}
         */
        this.key = key;

        /**
         * The location on the keyboard corresponding to the key pressed, as
         * defined at:
         * http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
         *
         * @type {Number}
         */
        this.location = location;

        // If key is known from keyCode or DOM3 alone, use that
        this.keysym =  keysym_from_key_identifier(key, location)
                    || keysym_from_keycode(keyCode, location);

        // DOM3 and keyCode are reliable sources if the corresponding key is
        // not a printable key
        if (this.keysym && !isPrintable(this.keysym))
            this.reliable = true;

        // Use legacy keyIdentifier as a last resort, if it looks sane
        if (!this.keysym && key_identifier_sane(keyCode, keyIdentifier))
            this.keysym = keysym_from_key_identifier(keyIdentifier, location, guac_keyboard.modifiers.shift);

        // Determine whether default action for Alt+combinations must be prevented
        var prevent_alt =  !guac_keyboard.modifiers.ctrl
                        && !(navigator && navigator.platform && navigator.platform.match(/^mac/i));

        // Determine whether default action for Ctrl+combinations must be prevented
        var prevent_ctrl = !guac_keyboard.modifiers.alt;

        // We must rely on the (potentially buggy) keyIdentifier if preventing
        // the default action is important
        if ((prevent_ctrl && guac_keyboard.modifiers.ctrl)
         || (prevent_alt  && guac_keyboard.modifiers.alt)
         || guac_keyboard.modifiers.meta
         || guac_keyboard.modifiers.hyper)
            this.reliable = true;

        // Record most recently known keysym by associated key code
        recentKeysym[keyCode] = this.keysym;

    };

    KeydownEvent.prototype = new KeyEvent();

    /**
     * Information related to the pressing of a key, which MUST be
     * associated with a printable character. The presence or absence of any
     * information within this object is browser-dependent.
     *
     * @private
     * @constructor
     * @augments Keyboard.KeyEvent
     * @param {Number} charCode The Unicode codepoint of the character that
     *                          would be typed by the key pressed.
     */
    var KeypressEvent = function(charCode) {

        // We extend KeyEvent
        KeyEvent.apply(this);

        /**
         * The Unicode codepoint of the character that would be typed by the
         * key pressed.
         *
         * @type {Number}
         */
        this.charCode = charCode;

        // Pull keysym from char code
        this.keysym = keysym_from_charcode(charCode);

        // Keypress is always reliable
        this.reliable = true;

    };

    KeypressEvent.prototype = new KeyEvent();

    /**
     * Information related to the pressing of a key, which need not be a key
     * associated with a printable character. The presence or absence of any
     * information within this object is browser-dependent.
     *
     * @private
     * @constructor
     * @augments Keyboard.KeyEvent
     * @param {Number} keyCode The JavaScript key code of the key released.
     * @param {String} keyIdentifier The legacy DOM3 "keyIdentifier" of the key
     *                               released, as defined at:
     *                               http://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#events-Events-KeyboardEvent
     * @param {String} key The standard name of the key released, as defined at:
     *                     http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     * @param {Number} location The location on the keyboard corresponding to
     *                          the key released, as defined at:
     *                          http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     */
    var KeyupEvent = function(keyCode, keyIdentifier, key, location) {

        // We extend KeyEvent
        KeyEvent.apply(this);

        /**
         * The JavaScript key code of the key released.
         *
         * @type {Number}
         */
        this.keyCode = keyCode;

        /**
         * The legacy DOM3 "keyIdentifier" of the key released, as defined at:
         * http://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#events-Events-KeyboardEvent
         *
         * @type {String}
         */
        this.keyIdentifier = keyIdentifier;

        /**
         * The standard name of the key released, as defined at:
         * http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
         *
         * @type {String}
         */
        this.key = key;

        /**
         * The location on the keyboard corresponding to the key released, as
         * defined at:
         * http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
         *
         * @type {Number}
         */
        this.location = location;

        // If key is known from keyCode or DOM3 alone, use that
        this.keysym =  recentKeysym[keyCode]
                    || keysym_from_keycode(keyCode, location)
                    || keysym_from_key_identifier(key, location); // keyCode is still more reliable for keyup when dead keys are in use

        // Keyup is as reliable as it will ever be
        this.reliable = true;

    };

    KeyupEvent.prototype = new KeyEvent();

    /**
     * An array of recorded events, which can be instances of the private
     * KeydownEvent, KeypressEvent, and KeyupEvent classes.
     *
     * @private
     * @type {KeyEvent[]}
     */
    var eventLog = [];

    /**
     * Map of known JavaScript keycodes which do not map to typable characters
     * to their X11 keysym equivalents.
     * @private
     */
    var keycodeKeysyms = {
        8:   [0xFF08], // backspace
        9:   [0xFF09], // tab
        12:  [0xFF0B, 0xFF0B, 0xFF0B, 0xFFB5], // clear       / KP 5
        13:  [0xFF0D], // enter
        16:  [0xFFE1, 0xFFE1, 0xFFE2], // shift
        17:  [0xFFE3, 0xFFE3, 0xFFE4], // ctrl
        18:  [0xFFE9, 0xFFE9, 0xFE03], // alt
        19:  [0xFF13], // pause/break
        20:  [0xFFE5], // caps lock
        27:  [0xFF1B], // escape
        32:  [0x0020], // space
        33:  [0xFF55, 0xFF55, 0xFF55, 0xFFB9], // page up     / KP 9
        34:  [0xFF56, 0xFF56, 0xFF56, 0xFFB3], // page down   / KP 3
        35:  [0xFF57, 0xFF57, 0xFF57, 0xFFB1], // end         / KP 1
        36:  [0xFF50, 0xFF50, 0xFF50, 0xFFB7], // home        / KP 7
        37:  [0xFF51, 0xFF51, 0xFF51, 0xFFB4], // left arrow  / KP 4
        38:  [0xFF52, 0xFF52, 0xFF52, 0xFFB8], // up arrow    / KP 8
        39:  [0xFF53, 0xFF53, 0xFF53, 0xFFB6], // right arrow / KP 6
        40:  [0xFF54, 0xFF54, 0xFF54, 0xFFB2], // down arrow  / KP 2
        45:  [0xFF63, 0xFF63, 0xFF63, 0xFFB0], // insert      / KP 0
        46:  [0xFFFF, 0xFFFF, 0xFFFF, 0xFFAE], // delete      / KP decimal
        91:  [0xFFEB], // left window key (hyper_l)
        92:  [0xFF67], // right window key (menu key?)
        93:  null,     // select key
        96:  [0xFFB0], // KP 0
        97:  [0xFFB1], // KP 1
        98:  [0xFFB2], // KP 2
        99:  [0xFFB3], // KP 3
        100: [0xFFB4], // KP 4
        101: [0xFFB5], // KP 5
        102: [0xFFB6], // KP 6
        103: [0xFFB7], // KP 7
        104: [0xFFB8], // KP 8
        105: [0xFFB9], // KP 9
        106: [0xFFAA], // KP multiply
        107: [0xFFAB], // KP add
        109: [0xFFAD], // KP subtract
        110: [0xFFAE], // KP decimal
        111: [0xFFAF], // KP divide
        112: [0xFFBE], // f1
        113: [0xFFBF], // f2
        114: [0xFFC0], // f3
        115: [0xFFC1], // f4
        116: [0xFFC2], // f5
        117: [0xFFC3], // f6
        118: [0xFFC4], // f7
        119: [0xFFC5], // f8
        120: [0xFFC6], // f9
        121: [0xFFC7], // f10
        122: [0xFFC8], // f11
        123: [0xFFC9], // f12
        144: [0xFF7F], // num lock
        145: [0xFF14], // scroll lock
        225: [0xFE03]  // altgraph (iso_level3_shift)
    };

    /**
     * Map of known JavaScript keyidentifiers which do not map to typable
     * characters to their unshifted X11 keysym equivalents.
     * @private
     */
    var keyidentifier_keysym = {
        "Again": [0xFF66],
        "AllCandidates": [0xFF3D],
        "Alphanumeric": [0xFF30],
        "Alt": [0xFFE9, 0xFFE9, 0xFE03],
        "Attn": [0xFD0E],
        "AltGraph": [0xFE03],
        "ArrowDown": [0xFF54],
        "ArrowLeft": [0xFF51],
        "ArrowRight": [0xFF53],
        "ArrowUp": [0xFF52],
        "Backspace": [0xFF08],
        "CapsLock": [0xFFE5],
        "Cancel": [0xFF69],
        "Clear": [0xFF0B],
        "Convert": [0xFF21],
        "Copy": [0xFD15],
        "Crsel": [0xFD1C],
        "CrSel": [0xFD1C],
        "CodeInput": [0xFF37],
        "Compose": [0xFF20],
        "Control": [0xFFE3, 0xFFE3, 0xFFE4],
        "ContextMenu": [0xFF67],
        "DeadGrave": [0xFE50],
        "DeadAcute": [0xFE51],
        "DeadCircumflex": [0xFE52],
        "DeadTilde": [0xFE53],
        "DeadMacron": [0xFE54],
        "DeadBreve": [0xFE55],
        "DeadAboveDot": [0xFE56],
        "DeadUmlaut": [0xFE57],
        "DeadAboveRing": [0xFE58],
        "DeadDoubleacute": [0xFE59],
        "DeadCaron": [0xFE5A],
        "DeadCedilla": [0xFE5B],
        "DeadOgonek": [0xFE5C],
        "DeadIota": [0xFE5D],
        "DeadVoicedSound": [0xFE5E],
        "DeadSemivoicedSound": [0xFE5F],
        "Delete": [0xFFFF],
        "Down": [0xFF54],
        "End": [0xFF57],
        "Enter": [0xFF0D],
        "EraseEof": [0xFD06],
        "Escape": [0xFF1B],
        "Execute": [0xFF62],
        "Exsel": [0xFD1D],
        "ExSel": [0xFD1D],
        "F1": [0xFFBE],
        "F2": [0xFFBF],
        "F3": [0xFFC0],
        "F4": [0xFFC1],
        "F5": [0xFFC2],
        "F6": [0xFFC3],
        "F7": [0xFFC4],
        "F8": [0xFFC5],
        "F9": [0xFFC6],
        "F10": [0xFFC7],
        "F11": [0xFFC8],
        "F12": [0xFFC9],
        "F13": [0xFFCA],
        "F14": [0xFFCB],
        "F15": [0xFFCC],
        "F16": [0xFFCD],
        "F17": [0xFFCE],
        "F18": [0xFFCF],
        "F19": [0xFFD0],
        "F20": [0xFFD1],
        "F21": [0xFFD2],
        "F22": [0xFFD3],
        "F23": [0xFFD4],
        "F24": [0xFFD5],
        "Find": [0xFF68],
        "GroupFirst": [0xFE0C],
        "GroupLast": [0xFE0E],
        "GroupNext": [0xFE08],
        "GroupPrevious": [0xFE0A],
        "FullWidth": null,
        "HalfWidth": null,
        "HangulMode": [0xFF31],
        "Hankaku": [0xFF29],
        "HanjaMode": [0xFF34],
        "Help": [0xFF6A],
        "Hiragana": [0xFF25],
        "HiraganaKatakana": [0xFF27],
        "Home": [0xFF50],
        "Hyper": [0xFFED, 0xFFED, 0xFFEE],
        "Insert": [0xFF63],
        "JapaneseHiragana": [0xFF25],
        "JapaneseKatakana": [0xFF26],
        "JapaneseRomaji": [0xFF24],
        "JunjaMode": [0xFF38],
        "KanaMode": [0xFF2D],
        "KanjiMode": [0xFF21],
        "Katakana": [0xFF26],
        "Left": [0xFF51],
        "Meta": [0xFFE7, 0xFFE7, 0xFFE8],
        "ModeChange": [0xFF7E],
        "NumLock": [0xFF7F],
        "PageDown": [0xFF56],
        "PageUp": [0xFF55],
        "Pause": [0xFF13],
        "Play": [0xFD16],
        "PreviousCandidate": [0xFF3E],
        "PrintScreen": [0xFD1D],
        "Redo": [0xFF66],
        "Right": [0xFF53],
        "RomanCharacters": null,
        "Scroll": [0xFF14],
        "Select": [0xFF60],
        "Separator": [0xFFAC],
        "Shift": [0xFFE1, 0xFFE1, 0xFFE2],
        "SingleCandidate": [0xFF3C],
        "Super": [0xFFEB, 0xFFEB, 0xFFEC],
        "Tab": [0xFF09],
        "Up": [0xFF52],
        "Undo": [0xFF65],
        "Win": [0xFFEB],
        "Zenkaku": [0xFF28],
        "ZenkakuHankaku": [0xFF2A]
    };

    /**
     * All keysyms which should not repeat when held down.
     * @private
     */
    var no_repeat = {
        0xFE03: true, // ISO Level 3 Shift (AltGr)
        0xFFE1: true, // Left shift
        0xFFE2: true, // Right shift
        0xFFE3: true, // Left ctrl
        0xFFE4: true, // Right ctrl
        0xFFE7: true, // Left meta
        0xFFE8: true, // Right meta
        0xFFE9: true, // Left alt
        0xFFEA: true, // Right alt
        0xFFEB: true, // Left hyper
        0xFFEC: true  // Right hyper
    };

    /**
     * All modifiers and their states.
     */
    this.modifiers = new Keyboard.ModifierState();

    /**
     * The state of every key, indexed by keysym. If a particular key is
     * pressed, the value of pressed for that keysym will be true. If a key
     * is not currently pressed, it will not be defined.
     */
    this.pressed = {};

    /**
     * The last result of calling the onkeydown handler for each key, indexed
     * by keysym. This is used to prevent/allow default actions for key events,
     * even when the onkeydown handler cannot be called again because the key
     * is (theoretically) still pressed.
     *
     * @private
     */
    var last_keydown_result = {};

    /**
     * The keysym most recently associated with a given keycode when keydown
     * fired. This object maps keycodes to keysyms.
     *
     * @private
     * @type {Object.<Number, Number>}
     */
    var recentKeysym = {};

    /**
     * Timeout before key repeat starts.
     * @private
     */
    var key_repeat_timeout = null;

    /**
     * Interval which presses and releases the last key pressed while that
     * key is still being held down.
     * @private
     */
    var key_repeat_interval = null;

    /**
     * Given an array of keysyms indexed by location, returns the keysym
     * for the given location, or the keysym for the standard location if
     * undefined.
     *
     * @private
     * @param {Number[]} keysyms
     *     An array of keysyms, where the index of the keysym in the array is
     *     the location value.
     *
     * @param {Number} location
     *     The location on the keyboard corresponding to the key pressed, as
     *     defined at: http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     */
    var get_keysym = function get_keysym(keysyms, location) {

        if (!keysyms)
            return null;

        return keysyms[location] || keysyms[0];
    };

    /**
     * Returns true if the given keysym corresponds to a printable character,
     * false otherwise.
     *
     * @param {Number} keysym
     *     The keysym to check.
     *
     * @returns {Boolean}
     *     true if the given keysym corresponds to a printable character,
     *     false otherwise.
     */
    var isPrintable = function isPrintable(keysym) {

        // Keysyms with Unicode equivalents are printable
        return (keysym >= 0x00 && keysym <= 0xFF)
            || (keysym & 0xFFFF0000) === 0x01000000;

    };

    function keysym_from_key_identifier(identifier, location, shifted) {

        if (!identifier)
            return null;

        var typedCharacter;

        // If identifier is U+xxxx, decode Unicode character
        var unicodePrefixLocation = identifier.indexOf("U+");
        if (unicodePrefixLocation >= 0) {
            var hex = identifier.substring(unicodePrefixLocation+2);
            typedCharacter = String.fromCharCode(parseInt(hex, 16));
        }

        // If single character and not keypad, use that as typed character
        else if (identifier.length === 1 && location !== 3)
            typedCharacter = identifier;

        // Otherwise, look up corresponding keysym
        else
            return get_keysym(keyidentifier_keysym[identifier], location);

        // Alter case if necessary
        if (shifted === true)
            typedCharacter = typedCharacter.toUpperCase();
        else if (shifted === false)
            typedCharacter = typedCharacter.toLowerCase();

        // Get codepoint
        var codepoint = typedCharacter.charCodeAt(0);
        return keysym_from_charcode(codepoint);

    }

    function isControlCharacter(codepoint) {
        return codepoint <= 0x1F || (codepoint >= 0x7F && codepoint <= 0x9F);
    }

    function keysym_from_charcode(codepoint) {

        // Keysyms for control characters
        if (isControlCharacter(codepoint)) return 0xFF00 | codepoint;

        // Keysyms for ASCII chars
        if (codepoint >= 0x0000 && codepoint <= 0x00FF)
            return codepoint;

        // Keysyms for Unicode
        if (codepoint >= 0x0100 && codepoint <= 0x10FFFF)
            return 0x01000000 | codepoint;

        return null;

    }

    function keysym_from_keycode(keyCode, location) {
        return get_keysym(keycodeKeysyms[keyCode], location);
    }

    /**
     * Heuristically detects if the legacy keyIdentifier property of
     * a keydown/keyup event looks incorrectly derived. Chrome, and
     * presumably others, will produce the keyIdentifier by assuming
     * the keyCode is the Unicode codepoint for that key. This is not
     * correct in all cases.
     *
     * @private
     * @param {Number} keyCode
     *     The keyCode from a browser keydown/keyup event.
     *
     * @param {String} keyIdentifier
     *     The legacy keyIdentifier from a browser keydown/keyup event.
     *
     * @returns {Boolean}
     *     true if the keyIdentifier looks sane, false if the keyIdentifier
     *     appears incorrectly derived or is missing entirely.
     */
    var key_identifier_sane = function key_identifier_sane(keyCode, keyIdentifier) {

        // Missing identifier is not sane
        if (!keyIdentifier)
            return false;

        // Assume non-Unicode keyIdentifier values are sane
        var unicodePrefixLocation = keyIdentifier.indexOf("U+");
        if (unicodePrefixLocation === -1)
            return true;

        // If the Unicode codepoint isn't identical to the keyCode,
        // then the identifier is likely correct
        var codepoint = parseInt(keyIdentifier.substring(unicodePrefixLocation+2), 16);
        if (keyCode !== codepoint)
            return true;

        // The keyCodes for A-Z and 0-9 are actually identical to their
        // Unicode codepoints
        if ((keyCode >= 65 && keyCode <= 90) || (keyCode >= 48 && keyCode <= 57))
            return true;

        // The keyIdentifier does NOT appear sane
        return false;

    };

    /**
     * Marks a key as pressed, firing the keydown event if registered. Key
     * repeat for the pressed key will start after a delay if that key is
     * not a modifier. The return value of this function depends on the
     * return value of the keydown event handler, if any.
     *
     * @param {Number} keysym The keysym of the key to press.
     * @return {Boolean} true if event should NOT be canceled, false otherwise.
     */
    this.press = function(keysym) {

        // Don't bother with pressing the key if the key is unknown
        if (keysym === null) return;

        // Only press if released
        if (!guac_keyboard.pressed[keysym]) {

            // Mark key as pressed
            guac_keyboard.pressed[keysym] = true;

            // Send key event
            if (guac_keyboard.onkeydown) {
                var result = guac_keyboard.onkeydown(keysym);
                last_keydown_result[keysym] = result;

                // Stop any current repeat
                window.clearTimeout(key_repeat_timeout);
                window.clearInterval(key_repeat_interval);

                // Repeat after a delay as long as pressed
                if (!no_repeat[keysym])
                    key_repeat_timeout = window.setTimeout(function() {
                        key_repeat_interval = window.setInterval(function() {
                            guac_keyboard.onkeyup(keysym);
                            guac_keyboard.onkeydown(keysym);
                        }, 50);
                    }, 500);

                return result;
            }
        }

        // Return the last keydown result by default, resort to false if unknown
        return last_keydown_result[keysym] || false;

    };

    /**
     * Marks a key as released, firing the keyup event if registered.
     *
     * @param {Number} keysym The keysym of the key to release.
     */
    this.release = function(keysym) {

        // Only release if pressed
        if (guac_keyboard.pressed[keysym]) {

            // Mark key as released
            delete guac_keyboard.pressed[keysym];

            // Stop repeat
            window.clearTimeout(key_repeat_timeout);
            window.clearInterval(key_repeat_interval);

            // Send key event
            if (keysym !== null && guac_keyboard.onkeyup)
                guac_keyboard.onkeyup(keysym);

        }

    };

    /**
     * Resets the state of this keyboard, releasing all keys, and firing keyup
     * events for each released key.
     */
    this.reset = function() {

        // Release all pressed keys
        for (var keysym in guac_keyboard.pressed)
            guac_keyboard.release(parseInt(keysym));

        // Clear event log
        eventLog = [];

    };

    /**
     * Given a keyboard event, updates the local modifier state and remote
     * key state based on the modifier flags within the event. This function
     * pays no attention to keycodes.
     *
     * @private
     * @param {KeyboardEvent} e
     *     The keyboard event containing the flags to update.
     */
    var update_modifier_state = function update_modifier_state(e) {

        // Get state
        var state = Keyboard.ModifierState.fromKeyboardEvent(e);

        // Release alt if implicitly released
        if (guac_keyboard.modifiers.alt && state.alt === false) {
            guac_keyboard.release(0xFFE9); // Left alt
            guac_keyboard.release(0xFFEA); // Right alt
            guac_keyboard.release(0xFE03); // AltGr
        }

        // Release shift if implicitly released
        if (guac_keyboard.modifiers.shift && state.shift === false) {
            guac_keyboard.release(0xFFE1); // Left shift
            guac_keyboard.release(0xFFE2); // Right shift
        }

        // Release ctrl if implicitly released
        if (guac_keyboard.modifiers.ctrl && state.ctrl === false) {
            guac_keyboard.release(0xFFE3); // Left ctrl
            guac_keyboard.release(0xFFE4); // Right ctrl
        }

        // Release meta if implicitly released
        if (guac_keyboard.modifiers.meta && state.meta === false) {
            guac_keyboard.release(0xFFE7); // Left meta
            guac_keyboard.release(0xFFE8); // Right meta
        }

        // Release hyper if implicitly released
        if (guac_keyboard.modifiers.hyper && state.hyper === false) {
            guac_keyboard.release(0xFFEB); // Left hyper
            guac_keyboard.release(0xFFEC); // Right hyper
        }

        // Update state
        guac_keyboard.modifiers = state;

    };

    /**
     * Reads through the event log, removing events from the head of the log
     * when the corresponding true key presses are known (or as known as they
     * can be).
     *
     * @private
     * @return {Boolean} Whether the default action of the latest event should
     *                   be prevented.
     */
    function interpret_events() {

        // Do not prevent default if no event could be interpreted
        var handled_event = interpret_event();
        if (!handled_event)
            return false;

        // Interpret as much as possible
        var last_event;
        do {
            last_event = handled_event;
            handled_event = interpret_event();
        } while (handled_event !== null);

        return last_event.defaultPrevented;

    }

    /**
     * Releases Ctrl+Alt, if both are currently pressed and the given keysym
     * looks like a key that may require AltGr.
     *
     * @private
     * @param {Number} keysym The key that was just pressed.
     */
    var release_simulated_altgr = function release_simulated_altgr(keysym) {

        // Both Ctrl+Alt must be pressed if simulated AltGr is in use
        if (!guac_keyboard.modifiers.ctrl || !guac_keyboard.modifiers.alt)
            return;

        // Assume [A-Z] never require AltGr
        if (keysym >= 0x0041 && keysym <= 0x005A)
            return;

        // Assume [a-z] never require AltGr
        if (keysym >= 0x0061 && keysym <= 0x007A)
            return;

        // Release Ctrl+Alt if the keysym is printable
        if (keysym <= 0xFF || (keysym & 0xFF000000) === 0x01000000) {
            guac_keyboard.release(0xFFE3); // Left ctrl
            guac_keyboard.release(0xFFE4); // Right ctrl
            guac_keyboard.release(0xFFE9); // Left alt
            guac_keyboard.release(0xFFEA); // Right alt
        }

    };

    /**
     * Reads through the event log, interpreting the first event, if possible,
     * and returning that event. If no events can be interpreted, due to a
     * total lack of events or the need for more events, null is returned. Any
     * interpreted events are automatically removed from the log.
     *
     * @private
     * @return {KeyEvent}
     *     The first key event in the log, if it can be interpreted, or null
     *     otherwise.
     */
    var interpret_event = function interpret_event() {

        // Peek at first event in log
        var first = eventLog[0];
        if (!first)
            return null;

        // Keydown event
        if (first instanceof KeydownEvent) {

            var keysym = null;
            var accepted_events = [];

            // If event itself is reliable, no need to wait for other events
            if (first.reliable) {
                keysym = first.keysym;
                accepted_events = eventLog.splice(0, 1);
            }

            // If keydown is immediately followed by a keypress, use the indicated character
            else if (eventLog[1] instanceof KeypressEvent) {
                keysym = eventLog[1].keysym;
                accepted_events = eventLog.splice(0, 2);
            }

            // If keydown is immediately followed by anything else, then no
            // keypress can possibly occur to clarify this event, and we must
            // handle it now
            else if (eventLog[1]) {
                keysym = first.keysym;
                accepted_events = eventLog.splice(0, 1);
            }

            // Fire a key press if valid events were found
            if (accepted_events.length > 0) {

                if (keysym) {

                    // Fire event
                    release_simulated_altgr(keysym);
                    var defaultPrevented = !guac_keyboard.press(keysym);
                    recentKeysym[first.keyCode] = keysym;

                    // If a key is pressed while meta is held down, the keyup will
                    // never be sent in Chrome, so send it now. (bug #108404)
                    if (guac_keyboard.modifiers.meta && keysym !== 0xFFE7 && keysym !== 0xFFE8)
                        guac_keyboard.release(keysym);

                    // Record whether default was prevented
                    for (var i=0; i<accepted_events.length; i++)
                        accepted_events[i].defaultPrevented = defaultPrevented;

                }

                return first;

            }

        } // end if keydown

        // Keyup event
        else if (first instanceof KeyupEvent) {

            // Release specific key if known
            var keysym = first.keysym;
            if (keysym) {
                guac_keyboard.release(keysym);
                first.defaultPrevented = true;
            }

            // Otherwise, fall back to releasing all keys
            else {
                guac_keyboard.reset();
                return first;
            }

            return eventLog.shift();

        } // end if keyup

        // Ignore any other type of event (keypress by itself is invalid)
        else
            return eventLog.shift();

        // No event interpreted
        return null;

    };

    /**
     * Returns the keyboard location of the key associated with the given
     * keyboard event. The location differentiates key events which otherwise
     * have the same keycode, such as left shift vs. right shift.
     *
     * @private
     * @param {KeyboardEvent} e
     *     A JavaScript keyboard event, as received through the DOM via a
     *     "keydown", "keyup", or "keypress" handler.
     *
     * @returns {Number}
     *     The location of the key event on the keyboard, as defined at:
     *     http://www.w3.org/TR/DOM-Level-3-Events/#events-KeyboardEvent
     */
    var getEventLocation = function getEventLocation(e) {

        // Use standard location, if possible
        if ('location' in e)
            return e.location;

        // Failing that, attempt to use deprecated keyLocation
        if ('keyLocation' in e)
            return e.keyLocation;

        // If no location is available, assume left side
        return 0;

    };

    // When key pressed
    element.addEventListener("keydown", function(e) {

        // Only intercept if handler set
        if (!guac_keyboard.onkeydown) return;

        var keyCode;
        if (window.event) keyCode = window.event.keyCode;
        else if (e.which) keyCode = e.which;

        // Fix modifier states
        update_modifier_state(e);

        // Ignore (but do not prevent) the "composition" keycode sent by some
        // browsers when an IME is in use (see: http://lists.w3.org/Archives/Public/www-dom/2010JulSep/att-0182/keyCode-spec.html)
        if (keyCode === 229)
            return;

        // Log event
        var keydownEvent = new KeydownEvent(keyCode, e.keyIdentifier, e.key, getEventLocation(e));
        eventLog.push(keydownEvent);

        // Interpret as many events as possible, prevent default if indicated
        if (interpret_events())
            e.preventDefault();

    }, true);

    // When key pressed
    element.addEventListener("keypress", function(e) {

        // Only intercept if handler set
        if (!guac_keyboard.onkeydown && !guac_keyboard.onkeyup) return;

        var charCode;
        if (window.event) charCode = window.event.keyCode;
        else if (e.which) charCode = e.which;

        // Fix modifier states
        update_modifier_state(e);

        // Log event
        var keypressEvent = new KeypressEvent(charCode);
        eventLog.push(keypressEvent);

        // Interpret as many events as possible, prevent default if indicated
        if (interpret_events())
            e.preventDefault();

    }, true);

    // When key released
    element.addEventListener("keyup", function(e) {

        // Only intercept if handler set
        if (!guac_keyboard.onkeyup) return;

        e.preventDefault();

        var keyCode;
        if (window.event) keyCode = window.event.keyCode;
        else if (e.which) keyCode = e.which;

        // Fix modifier states
        update_modifier_state(e);

        // Log event, call for interpretation
        var keyupEvent = new KeyupEvent(keyCode, e.keyIdentifier, e.key, getEventLocation(e));
        eventLog.push(keyupEvent);
        interpret_events();

    }, true);

}
/**
 * The state of all supported keyboard modifiers.
 * @constructor
 */
Keyboard.ModifierState = function() {

    /**
     * Whether shift is currently pressed.
     * @type {Boolean}
     */
    this.shift = false;

    /**
     * Whether ctrl is currently pressed.
     * @type {Boolean}
     */
    this.ctrl = false;

    /**
     * Whether alt is currently pressed.
     * @type {Boolean}
     */
    this.alt = false;

    /**
     * Whether meta (apple key) is currently pressed.
     * @type {Boolean}
     */
    this.meta = false;

    /**
     * Whether hyper (windows key) is currently pressed.
     * @type {Boolean}
     */
    this.hyper = false;

};

/**
 * Returns the modifier state applicable to the keyboard event given.
 *
 * @param {KeyboardEvent} e The keyboard event to read.
 * @returns {Keyboard.ModifierState} The current state of keyboard
 *                                             modifiers.
 */
Keyboard.ModifierState.fromKeyboardEvent = function(e) {

    var state = new Keyboard.ModifierState();

    // Assign states from old flags
    state.shift = e.shiftKey;
    state.ctrl  = e.ctrlKey;
    state.alt   = e.altKey;
    state.meta  = e.metaKey;

    // Use DOM3 getModifierState() for others
    if (e.getModifierState) {
        state.hyper = e.getModifierState("OS")
                   || e.getModifierState("Super")
                   || e.getModifierState("Hyper")
                   || e.getModifierState("Win");
    }

    return state;

};

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Provides cross-browser mouse events for a given element. The events of
 * the given element are automatically populated with handlers that translate
 * mouse events into a non-browser-specific event provided by the
 * Mouse instance.
 *
 * @constructor
 * @param {Element} element The Element to use to provide mouse events.
 */
function Mouse(element) {

    /**
     * Reference to this Mouse.
     * @private
     */
    var guac_mouse = this;

    /**
     * The number of mousemove events to require before re-enabling mouse
     * event handling after receiving a touch event.
     */
    this.touchMouseThreshold = 3;

    /**
     * The minimum amount of pixels scrolled required for a single scroll button
     * click.
     */
    this.scrollThreshold = 53;

    /**
     * The number of pixels to scroll per line.
     */
    this.PIXELS_PER_LINE = 18;

    /**
     * The number of pixels to scroll per page.
     */
    this.PIXELS_PER_PAGE = this.PIXELS_PER_LINE * 16;

    /**
     * The current mouse state. The properties of this state are updated when
     * mouse events fire. This state object is also passed in as a parameter to
     * the handler of any mouse events.
     *
     * @type {Mouse.State}
     */
    this.currentState = new Mouse.State(
        0, 0,
        false, false, false, false, false
    );

    /**
     * Fired whenever the user presses a mouse button down over the element
     * associated with this Mouse.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousedown = null;

    /**
     * Fired whenever the user releases a mouse button down over the element
     * associated with this Mouse.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmouseup = null;

    /**
     * Fired whenever the user moves the mouse over the element associated with
     * this Mouse.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousemove = null;

    /**
     * Fired whenever the mouse leaves the boundaries of the element associated
     * with this Mouse.
     *
     * @event
     */
	this.onmouseout = null;

    /**
     * Counter of mouse events to ignore. This decremented by mousemove, and
     * while non-zero, mouse events will have no effect.
     * @private
     */
    var ignore_mouse = 0;

    /**
     * Cumulative scroll delta amount. This value is accumulated through scroll
     * events and results in scroll button clicks if it exceeds a certain
     * threshold.
     *
     * @private
     */
    var scroll_delta = 0;

    function cancelEvent(e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        e.returnValue = false;
    }

    // Block context menu so right-click gets sent properly
    element.addEventListener("contextmenu", function(e) {
        cancelEvent(e);
    }, false);

    element.addEventListener("mousemove", function(e) {

        cancelEvent(e);

        // If ignoring events, decrement counter
        if (ignore_mouse) {
            ignore_mouse--;
            return;
        }

        guac_mouse.currentState.fromClientPosition(element, e.clientX, e.clientY);

        if (guac_mouse.onmousemove)
            guac_mouse.onmousemove(guac_mouse.currentState);

    }, false);

    element.addEventListener("mousedown", function(e) {

        cancelEvent(e);

        // Do not handle if ignoring events
        if (ignore_mouse)
            return;

        switch (e.button) {
            case 0:
                guac_mouse.currentState.left = true;
                break;
            case 1:
                guac_mouse.currentState.middle = true;
                break;
            case 2:
                guac_mouse.currentState.right = true;
                break;
        }

        if (guac_mouse.onmousedown)
            guac_mouse.onmousedown(guac_mouse.currentState);

    }, false);

    element.addEventListener("mouseup", function(e) {

        cancelEvent(e);

        // Do not handle if ignoring events
        if (ignore_mouse)
            return;

        switch (e.button) {
            case 0:
                guac_mouse.currentState.left = false;
                break;
            case 1:
                guac_mouse.currentState.middle = false;
                break;
            case 2:
                guac_mouse.currentState.right = false;
                break;
        }

        if (guac_mouse.onmouseup)
            guac_mouse.onmouseup(guac_mouse.currentState);

    }, false);

    element.addEventListener("mouseout", function(e) {

        // Get parent of the element the mouse pointer is leaving
       	if (!e) e = window.event;

        // Check that mouseout is due to actually LEAVING the element
        var target = e.relatedTarget || e.toElement;
        while (target) {
            if (target === element)
                return;
            target = target.parentNode;
        }

        cancelEvent(e);

        // Release all buttons
        if (guac_mouse.currentState.left
            || guac_mouse.currentState.middle
            || guac_mouse.currentState.right) {

            guac_mouse.currentState.left = false;
            guac_mouse.currentState.middle = false;
            guac_mouse.currentState.right = false;

            if (guac_mouse.onmouseup)
                guac_mouse.onmouseup(guac_mouse.currentState);
        }

        // Fire onmouseout event
        if (guac_mouse.onmouseout)
            guac_mouse.onmouseout();

    }, false);

    // Override selection on mouse event element.
    element.addEventListener("selectstart", function(e) {
        cancelEvent(e);
    }, false);

    // Ignore all pending mouse events when touch events are the apparent source
    function ignorePendingMouseEvents() { ignore_mouse = guac_mouse.touchMouseThreshold; }

    element.addEventListener("touchmove",  ignorePendingMouseEvents, false);
    element.addEventListener("touchstart", ignorePendingMouseEvents, false);
    element.addEventListener("touchend",   ignorePendingMouseEvents, false);

    // Scroll wheel support
    function mousewheel_handler(e) {

        // Determine approximate scroll amount (in pixels)
        var delta = e.deltaY || -e.wheelDeltaY || -e.wheelDelta;

        // If successfully retrieved scroll amount, convert to pixels if not
        // already in pixels
        if (delta) {

            // Convert to pixels if delta was lines
            if (e.deltaMode === 1)
                delta = e.deltaY * guac_mouse.PIXELS_PER_LINE;

            // Convert to pixels if delta was pages
            else if (e.deltaMode === 2)
                delta = e.deltaY * guac_mouse.PIXELS_PER_PAGE;

        }

        // Otherwise, assume legacy mousewheel event and line scrolling
        else
            delta = e.detail * guac_mouse.PIXELS_PER_LINE;

        // Update overall delta
        scroll_delta += delta;

        // Up
        if (scroll_delta <= -guac_mouse.scrollThreshold) {

            // Repeatedly click the up button until insufficient delta remains
            do {

                if (guac_mouse.onmousedown) {
                    guac_mouse.currentState.up = true;
                    guac_mouse.onmousedown(guac_mouse.currentState);
                }

                if (guac_mouse.onmouseup) {
                    guac_mouse.currentState.up = false;
                    guac_mouse.onmouseup(guac_mouse.currentState);
                }

                scroll_delta += guac_mouse.scrollThreshold;

            } while (scroll_delta <= -guac_mouse.scrollThreshold);

            // Reset delta
            scroll_delta = 0;

        }

        // Down
        if (scroll_delta >= guac_mouse.scrollThreshold) {

            // Repeatedly click the down button until insufficient delta remains
            do {

                if (guac_mouse.onmousedown) {
                    guac_mouse.currentState.down = true;
                    guac_mouse.onmousedown(guac_mouse.currentState);
                }

                if (guac_mouse.onmouseup) {
                    guac_mouse.currentState.down = false;
                    guac_mouse.onmouseup(guac_mouse.currentState);
                }

                scroll_delta -= guac_mouse.scrollThreshold;

            } while (scroll_delta >= guac_mouse.scrollThreshold);

            // Reset delta
            scroll_delta = 0;

        }

        cancelEvent(e);

    }

    element.addEventListener('DOMMouseScroll', mousewheel_handler, false);
    element.addEventListener('mousewheel',     mousewheel_handler, false);
    element.addEventListener('wheel',          mousewheel_handler, false);

    /**
     * Whether the browser supports CSS3 cursor styling, including hotspot
     * coordinates.
     *
     * @private
     * @type {Boolean}
     */
    var CSS3_CURSOR_SUPPORTED = (function() {

        var div = document.createElement("div");

        // If no cursor property at all, then no support
        if (!("cursor" in div.style))
            return false;

        try {
            // Apply simple 1x1 PNG
            div.style.cursor = "url(data:image/png;base64,"
                             + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
                             + "AQMAAAAl21bKAAAAA1BMVEX///+nxBvI"
                             + "AAAACklEQVQI12NgAAAAAgAB4iG8MwAA"
                             + "AABJRU5ErkJggg==) 0 0, auto";
        }
        catch (e) {
            return false;
        }

        // Verify cursor property is set to URL with hotspot
        return /\burl\([^()]*\)\s+0\s+0\b/.test(div.style.cursor || "");

    })();

    /**
     * Changes the local mouse cursor to the given canvas, having the given
     * hotspot coordinates. This affects styling of the element backing this
     * Mouse only, and may fail depending on browser support for
     * setting the mouse cursor.
     *
     * If setting the local cursor is desired, it is up to the implementation
     * to do something else, such as use the software cursor built into
     * Display, if the local cursor cannot be set.
     *
     * @param {HTMLCanvasElement} canvas The cursor image.
     * @param {Number} x The X-coordinate of the cursor hotspot.
     * @param {Number} y The Y-coordinate of the cursor hotspot.
     * @return {Boolean} true if the cursor was successfully set, false if the
     *                   cursor could not be set for any reason.
     */
    this.setCursor = function(canvas, x, y) {

        // Attempt to set via CSS3 cursor styling
        if (CSS3_CURSOR_SUPPORTED) {
            var dataURL = canvas.toDataURL('image/png');
            element.style.cursor = "url(" + dataURL + ") " + x + " " + y + ", auto";
            return true;
        }

        // Otherwise, setting cursor failed
        return false;

    };

}
/**
 * Simple container for properties describing the state of a mouse.
 *
 * @constructor
 * @param {Number} x The X position of the mouse pointer in pixels.
 * @param {Number} y The Y position of the mouse pointer in pixels.
 * @param {Boolean} left Whether the left mouse button is pressed.
 * @param {Boolean} middle Whether the middle mouse button is pressed.
 * @param {Boolean} right Whether the right mouse button is pressed.
 * @param {Boolean} up Whether the up mouse button is pressed (the fourth
 *                     button, usually part of a scroll wheel).
 * @param {Boolean} down Whether the down mouse button is pressed (the fifth
 *                       button, usually part of a scroll wheel).
 */
Mouse.State = function(x, y, left, middle, right, up, down) {

    /**
     * Reference to this Mouse.State.
     * @private
     */
    var guac_state = this;

    /**
     * The current X position of the mouse pointer.
     * @type {Number}
     */
    this.x = x;

    /**
     * The current Y position of the mouse pointer.
     * @type {Number}
     */
    this.y = y;

    /**
     * Whether the left mouse button is currently pressed.
     * @type {Boolean}
     */
    this.left = left;

    /**
     * Whether the middle mouse button is currently pressed.
     * @type {Boolean}
     */
    this.middle = middle;

    /**
     * Whether the right mouse button is currently pressed.
     * @type {Boolean}
     */
    this.right = right;

    /**
     * Whether the up mouse button is currently pressed. This is the fourth
     * mouse button, associated with upward scrolling of the mouse scroll
     * wheel.
     * @type {Boolean}
     */
    this.up = up;

    /**
     * Whether the down mouse button is currently pressed. This is the fifth
     * mouse button, associated with downward scrolling of the mouse scroll
     * wheel.
     * @type {Boolean}
     */
    this.down = down;

    /**
     * Updates the position represented within this state object by the given
     * element and clientX/clientY coordinates (commonly available within event
     * objects). Position is translated from clientX/clientY (relative to
     * viewport) to element-relative coordinates.
     *
     * @param {Element} element The element the coordinates should be relative
     *                          to.
     * @param {Number} clientX The X coordinate to translate, viewport-relative.
     * @param {Number} clientY The Y coordinate to translate, viewport-relative.
     */
    this.fromClientPosition = function(element, clientX, clientY) {

        guac_state.x = clientX - element.offsetLeft;
        guac_state.y = clientY - element.offsetTop;

        // This is all JUST so we can get the mouse position within the element
        var parent = element.offsetParent;
        while (parent && !(parent === document.body)) {
            guac_state.x -= parent.offsetLeft - parent.scrollLeft;
            guac_state.y -= parent.offsetTop  - parent.scrollTop;

            parent = parent.offsetParent;
        }

        // Element ultimately depends on positioning within document body,
        // take document scroll into account.
        if (parent) {
            var documentScrollLeft = document.body.scrollLeft || document.documentElement.scrollLeft;
            var documentScrollTop = document.body.scrollTop || document.documentElement.scrollTop;

            guac_state.x -= parent.offsetLeft - documentScrollLeft;
            guac_state.y -= parent.offsetTop  - documentScrollTop;
        }

    };

};

/**
 * Provides cross-browser relative touch event translation for a given element.
 *
 * Touch events are translated into mouse events as if the touches occurred
 * on a touchpad (drag to push the mouse pointer, tap to click).
 *
 * @constructor
 * @param {Element} element The Element to use to provide touch events.
 */
Mouse.Touchpad = function(element) {

    /**
     * Reference to this Mouse.Touchpad.
     * @private
     */
    var guac_touchpad = this;

    /**
     * The distance a two-finger touch must move per scrollwheel event, in
     * pixels.
     */
    this.scrollThreshold = 20 * (window.devicePixelRatio || 1);

    /**
     * The maximum number of milliseconds to wait for a touch to end for the
     * gesture to be considered a click.
     */
    this.clickTimingThreshold = 250;

    /**
     * The maximum number of pixels to allow a touch to move for the gesture to
     * be considered a click.
     */
    this.clickMoveThreshold = 10 * (window.devicePixelRatio || 1);

    /**
     * The current mouse state. The properties of this state are updated when
     * mouse events fire. This state object is also passed in as a parameter to
     * the handler of any mouse events.
     *
     * @type {Mouse.State}
     */
    this.currentState = new Mouse.State(
        0, 0,
        false, false, false, false, false
    );

    /**
     * Fired whenever a mouse button is effectively pressed. This can happen
     * as part of a "click" gesture initiated by the user by tapping one
     * or more fingers over the touchpad element, as part of a "scroll"
     * gesture initiated by dragging two fingers up or down, etc.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousedown = null;

    /**
     * Fired whenever a mouse button is effectively released. This can happen
     * as part of a "click" gesture initiated by the user by tapping one
     * or more fingers over the touchpad element, as part of a "scroll"
     * gesture initiated by dragging two fingers up or down, etc.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmouseup = null;

    /**
     * Fired whenever the user moves the mouse by dragging their finger over
     * the touchpad element.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousemove = null;

    var touch_count = 0;
    var last_touch_x = 0;
    var last_touch_y = 0;
    var last_touch_time = 0;
    var pixels_moved = 0;

    var touch_buttons = {
        1: "left",
        2: "right",
        3: "middle"
    };

    var gesture_in_progress = false;
    var click_release_timeout = null;

    element.addEventListener("touchend", function(e) {

        e.preventDefault();

        // If we're handling a gesture AND this is the last touch
        if (gesture_in_progress && e.touches.length === 0) {

            var time = new Date().getTime();

            // Get corresponding mouse button
            var button = touch_buttons[touch_count];

            // If mouse already down, release anad clear timeout
            if (guac_touchpad.currentState[button]) {

                // Fire button up event
                guac_touchpad.currentState[button] = false;
                if (guac_touchpad.onmouseup)
                    guac_touchpad.onmouseup(guac_touchpad.currentState);

                // Clear timeout, if set
                if (click_release_timeout) {
                    window.clearTimeout(click_release_timeout);
                    click_release_timeout = null;
                }

            }

            // If single tap detected (based on time and distance)
            if (time - last_touch_time <= guac_touchpad.clickTimingThreshold
                    && pixels_moved < guac_touchpad.clickMoveThreshold) {

                // Fire button down event
                guac_touchpad.currentState[button] = true;
                if (guac_touchpad.onmousedown)
                    guac_touchpad.onmousedown(guac_touchpad.currentState);

                // Delay mouse up - mouse up should be canceled if
                // touchstart within timeout.
                click_release_timeout = window.setTimeout(function() {

                    // Fire button up event
                    guac_touchpad.currentState[button] = false;
                    if (guac_touchpad.onmouseup)
                        guac_touchpad.onmouseup(guac_touchpad.currentState);

                    // Gesture now over
                    gesture_in_progress = false;

                }, guac_touchpad.clickTimingThreshold);

            }

            // If we're not waiting to see if this is a click, stop gesture
            if (!click_release_timeout)
                gesture_in_progress = false;

        }

    }, false);

    element.addEventListener("touchstart", function(e) {

        e.preventDefault();

        // Track number of touches, but no more than three
        touch_count = Math.min(e.touches.length, 3);

        // Clear timeout, if set
        if (click_release_timeout) {
            window.clearTimeout(click_release_timeout);
            click_release_timeout = null;
        }

        // Record initial touch location and time for touch movement
        // and tap gestures
        if (!gesture_in_progress) {

            // Stop mouse events while touching
            gesture_in_progress = true;

            // Record touch location and time
            var starting_touch = e.touches[0];
            last_touch_x = starting_touch.clientX;
            last_touch_y = starting_touch.clientY;
            last_touch_time = new Date().getTime();
            pixels_moved = 0;

        }

    }, false);

    element.addEventListener("touchmove", function(e) {

        e.preventDefault();

        // Get change in touch location
        var touch = e.touches[0];
        var delta_x = touch.clientX - last_touch_x;
        var delta_y = touch.clientY - last_touch_y;

        // Track pixels moved
        pixels_moved += Math.abs(delta_x) + Math.abs(delta_y);

        // If only one touch involved, this is mouse move
        if (touch_count === 1) {

            // Calculate average velocity in Manhatten pixels per millisecond
            var velocity = pixels_moved / (new Date().getTime() - last_touch_time);

            // Scale mouse movement relative to velocity
            var scale = 1 + velocity;

            // Update mouse location
            guac_touchpad.currentState.x += delta_x*scale;
            guac_touchpad.currentState.y += delta_y*scale;

            // Prevent mouse from leaving screen

            if (guac_touchpad.currentState.x < 0)
                guac_touchpad.currentState.x = 0;
            else if (guac_touchpad.currentState.x >= element.offsetWidth)
                guac_touchpad.currentState.x = element.offsetWidth - 1;

            if (guac_touchpad.currentState.y < 0)
                guac_touchpad.currentState.y = 0;
            else if (guac_touchpad.currentState.y >= element.offsetHeight)
                guac_touchpad.currentState.y = element.offsetHeight - 1;

            // Fire movement event, if defined
            if (guac_touchpad.onmousemove)
                guac_touchpad.onmousemove(guac_touchpad.currentState);

            // Update touch location
            last_touch_x = touch.clientX;
            last_touch_y = touch.clientY;

        }

        // Interpret two-finger swipe as scrollwheel
        else if (touch_count === 2) {

            // If change in location passes threshold for scroll
            if (Math.abs(delta_y) >= guac_touchpad.scrollThreshold) {

                // Decide button based on Y movement direction
                var button;
                if (delta_y > 0) button = "down";
                else             button = "up";

                // Fire button down event
                guac_touchpad.currentState[button] = true;
                if (guac_touchpad.onmousedown)
                    guac_touchpad.onmousedown(guac_touchpad.currentState);

                // Fire button up event
                guac_touchpad.currentState[button] = false;
                if (guac_touchpad.onmouseup)
                    guac_touchpad.onmouseup(guac_touchpad.currentState);

                // Only update touch location after a scroll has been
                // detected
                last_touch_x = touch.clientX;
                last_touch_y = touch.clientY;

            }

        }

    }, false);

};

/**
 * Provides cross-browser absolute touch event translation for a given element.
 *
 * Touch events are translated into mouse events as if the touches occurred
 * on a touchscreen (tapping anywhere on the screen clicks at that point,
 * long-press to right-click).
 *
 * @constructor
 * @param {Element} element The Element to use to provide touch events.
 */
Mouse.Touchscreen = function(element) {

    /**
     * Reference to this Mouse.Touchscreen.
     * @private
     */
    var guac_touchscreen = this;

    /**
     * Whether a gesture is known to be in progress. If false, touch events
     * will be ignored.
     *
     * @private
     */
    var gesture_in_progress = false;

    /**
     * The start X location of a gesture.
     * @private
     */
    var gesture_start_x = null;

    /**
     * The start Y location of a gesture.
     * @private
     */
    var gesture_start_y = null;

    /**
     * The timeout associated with the delayed, cancellable click release.
     *
     * @private
     */
    var click_release_timeout = null;

    /**
     * The timeout associated with long-press for right click.
     *
     * @private
     */
    var long_press_timeout = null;

    /**
     * The distance a two-finger touch must move per scrollwheel event, in
     * pixels.
     */
    this.scrollThreshold = 20 * (window.devicePixelRatio || 1);

    /**
     * The maximum number of milliseconds to wait for a touch to end for the
     * gesture to be considered a click.
     */
    this.clickTimingThreshold = 250;

    /**
     * The maximum number of pixels to allow a touch to move for the gesture to
     * be considered a click.
     */
    this.clickMoveThreshold = 16 * (window.devicePixelRatio || 1);

    /**
     * The amount of time a press must be held for long press to be
     * detected.
     */
    this.longPressThreshold = 500;

    /**
     * The current mouse state. The properties of this state are updated when
     * mouse events fire. This state object is also passed in as a parameter to
     * the handler of any mouse events.
     *
     * @type {Mouse.State}
     */
    this.currentState = new Mouse.State(
        0, 0,
        false, false, false, false, false
    );

    /**
     * Fired whenever a mouse button is effectively pressed. This can happen
     * as part of a "mousedown" gesture initiated by the user by pressing one
     * finger over the touchscreen element, as part of a "scroll" gesture
     * initiated by dragging two fingers up or down, etc.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousedown = null;

    /**
     * Fired whenever a mouse button is effectively released. This can happen
     * as part of a "mouseup" gesture initiated by the user by removing the
     * finger pressed against the touchscreen element, or as part of a "scroll"
     * gesture initiated by dragging two fingers up or down, etc.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmouseup = null;

    /**
     * Fired whenever the user moves the mouse by dragging their finger over
     * the touchscreen element. Note that unlike Mouse.Touchpad,
     * dragging a finger over the touchscreen element will always cause
     * the mouse button to be effectively down, as if clicking-and-dragging.
     *
     * @event
     * @param {Mouse.State} state The current mouse state.
     */
	this.onmousemove = null;

    /**
     * Presses the given mouse button, if it isn't already pressed. Valid
     * button values are "left", "middle", "right", "up", and "down".
     *
     * @private
     * @param {String} button The mouse button to press.
     */
    function press_button(button) {
        if (!guac_touchscreen.currentState[button]) {
            guac_touchscreen.currentState[button] = true;
            if (guac_touchscreen.onmousedown)
                guac_touchscreen.onmousedown(guac_touchscreen.currentState);
        }
    }

    /**
     * Releases the given mouse button, if it isn't already released. Valid
     * button values are "left", "middle", "right", "up", and "down".
     *
     * @private
     * @param {String} button The mouse button to release.
     */
    function release_button(button) {
        if (guac_touchscreen.currentState[button]) {
            guac_touchscreen.currentState[button] = false;
            if (guac_touchscreen.onmouseup)
                guac_touchscreen.onmouseup(guac_touchscreen.currentState);
        }
    }

    /**
     * Clicks (presses and releases) the given mouse button. Valid button
     * values are "left", "middle", "right", "up", and "down".
     *
     * @private
     * @param {String} button The mouse button to click.
     */
    function click_button(button) {
        press_button(button);
        release_button(button);
    }

    /**
     * Moves the mouse to the given coordinates. These coordinates must be
     * relative to the browser window, as they will be translated based on
     * the touch event target's location within the browser window.
     *
     * @private
     * @param {Number} x The X coordinate of the mouse pointer.
     * @param {Number} y The Y coordinate of the mouse pointer.
     */
    function move_mouse(x, y) {
        guac_touchscreen.currentState.fromClientPosition(element, x, y);
        if (guac_touchscreen.onmousemove)
            guac_touchscreen.onmousemove(guac_touchscreen.currentState);
    }

    /**
     * Returns whether the given touch event exceeds the movement threshold for
     * clicking, based on where the touch gesture began.
     *
     * @private
     * @param {TouchEvent} e The touch event to check.
     * @return {Boolean} true if the movement threshold is exceeded, false
     *                   otherwise.
     */
    function finger_moved(e) {
        var touch = e.touches[0] || e.changedTouches[0];
        var delta_x = touch.clientX - gesture_start_x;
        var delta_y = touch.clientY - gesture_start_y;
        return Math.sqrt(delta_x*delta_x + delta_y*delta_y) >= guac_touchscreen.clickMoveThreshold;
    }

    /**
     * Begins a new gesture at the location of the first touch in the given
     * touch event.
     *
     * @private
     * @param {TouchEvent} e The touch event beginning this new gesture.
     */
    function begin_gesture(e) {
        var touch = e.touches[0];
        gesture_in_progress = true;
        gesture_start_x = touch.clientX;
        gesture_start_y = touch.clientY;
    }

    /**
     * End the current gesture entirely. Wait for all touches to be done before
     * resuming gesture detection.
     *
     * @private
     */
    function end_gesture() {
        window.clearTimeout(click_release_timeout);
        window.clearTimeout(long_press_timeout);
        gesture_in_progress = false;
    }

    element.addEventListener("touchend", function(e) {

        // Do not handle if no gesture
        if (!gesture_in_progress)
            return;

        // Ignore if more than one touch
        if (e.touches.length !== 0 || e.changedTouches.length !== 1) {
            end_gesture();
            return;
        }

        // Long-press, if any, is over
        window.clearTimeout(long_press_timeout);

        // Always release mouse button if pressed
        release_button("left");

        // If finger hasn't moved enough to cancel the click
        if (!finger_moved(e)) {

            e.preventDefault();

            // If not yet pressed, press and start delay release
            if (!guac_touchscreen.currentState.left) {

                var touch = e.changedTouches[0];
                move_mouse(touch.clientX, touch.clientY);
                press_button("left");

                // Release button after a delay, if not canceled
                click_release_timeout = window.setTimeout(function() {
                    release_button("left");
                    end_gesture();
                }, guac_touchscreen.clickTimingThreshold);

            }

        } // end if finger not moved

    }, false);

    element.addEventListener("touchstart", function(e) {

        // Ignore if more than one touch
        if (e.touches.length !== 1) {
            end_gesture();
            return;
        }

        e.preventDefault();

        // New touch begins a new gesture
        begin_gesture(e);

        // Keep button pressed if tap after left click
        window.clearTimeout(click_release_timeout);

        // Click right button if this turns into a long-press
        long_press_timeout = window.setTimeout(function() {
            var touch = e.touches[0];
            move_mouse(touch.clientX, touch.clientY);
            click_button("right");
            end_gesture();
        }, guac_touchscreen.longPressThreshold);

    }, false);

    element.addEventListener("touchmove", function(e) {

        // Do not handle if no gesture
        if (!gesture_in_progress)
            return;

        // Cancel long press if finger moved
        if (finger_moved(e))
            window.clearTimeout(long_press_timeout);

        // Ignore if more than one touch
        if (e.touches.length !== 1) {
            end_gesture();
            return;
        }

        // Update mouse position if dragging
        if (guac_touchscreen.currentState.left) {

            e.preventDefault();

            // Update state
            var touch = e.touches[0];
            move_mouse(touch.clientX, touch.clientY);

        }

    }, false);

};

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Dynamic on-screen keyboard. Given the layout object for an on-screen
 * keyboard, this object will construct a clickable on-screen keyboard with its
 * own key events.
 *
 * @constructor
 * @param {OnScreenKeyboard.Layout} layout
 *     The layout of the on-screen keyboard to display.
 */
function OnScreenKeyboard(layout) {

    /**
     * Reference to this OnScreenKeyboard.
     *
     * @private
     * @type {OnScreenKeyboard}
     */
    var osk = this;

    /**
     * Map of currently-set modifiers to the keysym associated with their
     * original press. When the modifier is cleared, this keysym must be
     * released.
     *
     * @private
     * @type {Object.<String, Number>}
     */
    var modifierKeysyms = {};

    /**
     * Map of all key names to their current pressed states. If a key is not
     * pressed, it may not be in this map at all, but all pressed keys will
     * have a corresponding mapping to true.
     *
     * @private
     * @type {Object.<String, Boolean>}
     */
    var pressed = {};

    /**
     * All scalable elements which are part of the on-screen keyboard. Each
     * scalable element is carefully controlled to ensure the interface layout
     * and sizing remains constant, even on browsers that would otherwise
     * experience rounding error due to unit conversions.
     *
     * @private
     * @type {ScaledElement[]}
     */
    var scaledElements = [];

    /**
     * Adds a CSS class to an element.
     *
     * @private
     * @function
     * @param {Element} element
     *     The element to add a class to.
     *
     * @param {String} classname
     *     The name of the class to add.
     */
    var addClass = function addClass(element, classname) {

        // If classList supported, use that
        if (element.classList)
            element.classList.add(classname);

        // Otherwise, simply append the class
        else
            element.className += " " + classname;

    };

    /**
     * Removes a CSS class from an element.
     *
     * @private
     * @function
     * @param {Element} element
     *     The element to remove a class from.
     *
     * @param {String} classname
     *     The name of the class to remove.
     */
    var removeClass = function removeClass(element, classname) {

        // If classList supported, use that
        if (element.classList)
            element.classList.remove(classname);

        // Otherwise, manually filter out classes with given name
        else {
            element.className = element.className.replace(/([^ ]+)[ ]*/g,
                function removeMatchingClasses(match, testClassname) {

                    // If same class, remove
                    if (testClassname === classname)
                        return "";

                    // Otherwise, allow
                    return match;

                }
            );
        }

    };

    /**
     * Counter of mouse events to ignore. This decremented by mousemove, and
     * while non-zero, mouse events will have no effect.
     *
     * @private
     * @type {Number}
     */
    var ignoreMouse = 0;

    /**
     * An element whose dimensions are maintained according to an arbitrary
     * scale. The conversion factor for these arbitrary units to pixels is
     * provided later via a call to scale().
     *
     * @private
     * @constructor
     * @param {Element} element
     *     The element whose scale should be maintained.
     *
     * @param {Number} width
     *     The width of the element, in arbitrary units, relative to other
     *     ScaledElements.
     *
     * @param {Number} height
     *     The height of the element, in arbitrary units, relative to other
     *     ScaledElements.
     *
     * @param {Boolean} [scaleFont=false]
     *     Whether the line height and font size should be scaled as well.
     */
    var ScaledElement = function ScaledElement(element, width, height, scaleFont) {

        /**
         * The width of this ScaledElement, in arbitrary units, relative to
         * other ScaledElements.
         *
         * @type {Number}
         */
         this.width = width;

        /**
         * The height of this ScaledElement, in arbitrary units, relative to
         * other ScaledElements.
         *
         * @type {Number}
         */
         this.height = height;

        /**
         * Resizes the associated element, updating its dimensions according to
         * the given pixels per unit.
         *
         * @param {Number} pixels
         *     The number of pixels to assign per arbitrary unit.
         */
        this.scale = function(pixels) {

            // Scale element width/height
            element.style.width  = (width  * pixels) + "px";
            element.style.height = (height * pixels) + "px";

            // Scale font, if requested
            if (scaleFont) {
                element.style.lineHeight = (height * pixels) + "px";
                element.style.fontSize   = pixels + "px";
            }

        };

    };

    /**
     * Returns whether all modifiers having the given names are currently
     * active.
     *
     * @private
     * @param {String[]} names
     *     The names of all modifiers to test.
     *
     * @returns {Boolean}
     *     true if all specified modifiers are pressed, false otherwise.
     */
    var modifiersPressed = function modifiersPressed(names) {

        // If any required modifiers are not pressed, return false
        for (var i=0; i < names.length; i++) {

            // Test whether current modifier is pressed
            var name = names[i];
            if (!(name in modifierKeysyms))
                return false;

        }

        // Otherwise, all required modifiers are pressed
        return true;

    };

    /**
     * Returns the single matching Key object associated with the key of the
     * given name, where that Key object's requirements (such as pressed
     * modifiers) are all currently satisfied.
     *
     * @private
     * @param {String} keyName
     *     The name of the key to retrieve.
     *
     * @returns {OnScreenKeyboard.Key}
     *     The Key object associated with the given name, where that object's
     *     requirements are all currently satisfied, or null if no such Key
     *     can be found.
     */
    var getActiveKey = function getActiveKey(keyName) {

        // Get key array for given name
        var keys = osk.keys[keyName];
        if (!keys)
            return null;

        // Find last matching key
        for (var i = keys.length - 1; i >= 0; i--) {

            // Get candidate key
            var candidate = keys[i];

            // If all required modifiers are pressed, use that key
            if (modifiersPressed(candidate.requires))
                return candidate;

        }

        // No valid key
        return null;

    };

    /**
     * Presses the key having the given name, updating the associated key
     * element with the "guac-keyboard-pressed" CSS class. If the key is
     * already pressed, this function has no effect.
     *
     * @private
     * @param {String} keyName
     *     The name of the key to press.
     *
     * @param {String} keyElement
     *     The element associated with the given key.
     */
    var press = function press(keyName, keyElement) {

        // Press key if not yet pressed
        if (!pressed[keyName]) {

            addClass(keyElement, "guac-keyboard-pressed");

            // Get current key based on modifier state
            var key = getActiveKey(keyName);

            // Update modifier state
            if (key.modifier) {

                // Construct classname for modifier
                var modifierClass = "guac-keyboard-modifier-" + getCSSName(key.modifier);

                // Retrieve originally-pressed keysym, if modifier was already pressed
                var originalKeysym = modifierKeysyms[key.modifier];

                // Activate modifier if not pressed
                if (!originalKeysym) {

                    addClass(keyboard, modifierClass);
                    modifierKeysyms[key.modifier] = key.keysym;

                    // Send key event
                    if (osk.onkeydown)
                        osk.onkeydown(key.keysym);

                }

                // Deactivate if not pressed
                else {

                    removeClass(keyboard, modifierClass);
                    delete modifierKeysyms[key.modifier];

                    // Send key event
                    if (osk.onkeyup)
                        osk.onkeyup(originalKeysym);

                }

            }

            // If not modifier, send key event now
            else if (osk.onkeydown)
                osk.onkeydown(key.keysym);

            // Mark key as pressed
            pressed[keyName] = true;

        }

    };

    /**
     * Releases the key having the given name, removing the
     * "guac-keyboard-pressed" CSS class from the associated element. If the
     * key is already released, this function has no effect.
     *
     * @private
     * @param {String} keyName
     *     The name of the key to release.
     *
     * @param {String} keyElement
     *     The element associated with the given key.
     */
    var release = function release(keyName, keyElement) {

        // Release key if currently pressed
        if (pressed[keyName]) {

            removeClass(keyElement, "guac-keyboard-pressed");

            // Get current key based on modifier state
            var key = getActiveKey(keyName);

            // Send key event if not a modifier key
            if (!key.modifier && osk.onkeyup)
                osk.onkeyup(key.keysym);

            // Mark key as released
            pressed[keyName] = false;

        }

    };

    // Create keyboard
    var keyboard = document.createElement("div");
    keyboard.className = "guac-keyboard";

    // Do not allow selection or mouse movement to propagate/register.
    keyboard.onselectstart =
    keyboard.onmousemove   =
    keyboard.onmouseup     =
    keyboard.onmousedown   = function handleMouseEvents(e) {

        // If ignoring events, decrement counter
        if (ignoreMouse)
            ignoreMouse--;

        e.stopPropagation();
        return false;

    };

    /**
     * The number of mousemove events to require before re-enabling mouse
     * event handling after receiving a touch event.
     *
     * @type {Number}
     */
    this.touchMouseThreshold = 3;

    /**
     * Fired whenever the user presses a key on this OnScreenKeyboard.
     *
     * @event
     * @param {Number} keysym The keysym of the key being pressed.
     */
    this.onkeydown = null;

    /**
     * Fired whenever the user releases a key on this OnScreenKeyboard.
     *
     * @event
     * @param {Number} keysym The keysym of the key being released.
     */
    this.onkeyup = null;

    /**
     * The keyboard layout provided at time of construction.
     *
     * @type {OnScreenKeyboard.Layout}
     */
    this.layout = new OnScreenKeyboard.Layout(layout);

    /**
     * Returns the element containing the entire on-screen keyboard.
     * @returns {Element} The element containing the entire on-screen keyboard.
     */
    this.getElement = function() {
        return keyboard;
    };

    /**
     * Resizes all elements within this OnScreenKeyboard such that
     * the width is close to but does not exceed the specified width. The
     * height of the keyboard is determined based on the width.
     *
     * @param {Number} width The width to resize this OnScreenKeyboard
     *                       to, in pixels.
     */
    this.resize = function(width) {

        // Get pixel size of a unit
        var unit = Math.floor(width * 10 / osk.layout.width) / 10;

        // Resize all scaled elements
        for (var i=0; i<scaledElements.length; i++) {
            var scaledElement = scaledElements[i];
            scaledElement.scale(unit);
        }

    };

    /**
     * Given the name of a key and its corresponding definition, which may be
     * an array of keys objects, a number (keysym), a string (key title), or a
     * single key object, returns an array of key objects, deriving any missing
     * properties as needed, and ensuring the key name is defined.
     *
     * @private
     * @param {String} name
     *     The name of the key being coerced into an array of Key objects.
     *
     * @param {Number|String|OnScreenKeyboard.Key|OnScreenKeyboard.Key[]} object
     *     The object defining the behavior of the key having the given name,
     *     which may be the title of the key (a string), the keysym (a number),
     *     a single Key object, or an array of Key objects.
     *
     * @returns {OnScreenKeyboard.Key[]}
     *     An array of all keys associated with the given name.
     */
    var asKeyArray = function asKeyArray(name, object) {

        // If already an array, just coerce into a true Key[]
        if (object instanceof Array) {
            var keys = [];
            for (var i=0; i < object.length; i++) {
                keys.push(new OnScreenKeyboard.Key(object[i], name));
            }
            return keys;
        }

        // Derive key object from keysym if that's all we have
        if (typeof object === 'number') {
            return [new OnScreenKeyboard.Key({
                name   : name,
                keysym : object
            })];
        }

        // Derive key object from title if that's all we have
        if (typeof object === 'string') {
            return [new OnScreenKeyboard.Key({
                name  : name,
                title : object
            })];
        }

        // Otherwise, assume it's already a key object, just not an array
        return [new OnScreenKeyboard.Key(object, name)];

    };

    /**
     * Converts the rather forgiving key mapping allowed by
     * OnScreenKeyboard.Layout into a rigorous mapping of key name
     * to key definition, where the key definition is always an array of Key
     * objects.
     *
     * @private
     * @param {Object.<String, Number|String|OnScreenKeyboard.Key|OnScreenKeyboard.Key[]>} keys
     *     A mapping of key name to key definition, where the key definition is
     *     the title of the key (a string), the keysym (a number), a single
     *     Key object, or an array of Key objects.
     *
     * @returns {Object.<String, OnScreenKeyboard.Key[]>}
     *     A more-predictable mapping of key name to key definition, where the
     *     key definition is always simply an array of Key objects.
     */
    var getKeys = function getKeys(keys) {

        var keyArrays = {};

        // Coerce all keys into individual key arrays
        for (var name in layout.keys) {
            keyArrays[name] = asKeyArray(name, keys[name]);
        }

        return keyArrays;

    };

    /**
     * Map of all key names to their corresponding set of keys. Each key name
     * may correspond to multiple keys due to the effect of modifiers.
     *
     * @type {Object.<String, OnScreenKeyboard.Key[]>}
     */
    this.keys = getKeys(layout.keys);

    /**
     * Given an arbitrary string representing the name of some component of the
     * on-screen keyboard, returns a string formatted for use as a CSS class
     * name. The result will be lowercase. Word boundaries previously denoted
     * by CamelCase will be replaced by individual hyphens, as will all
     * contiguous non-alphanumeric characters.
     *
     * @private
     * @param {String} name
     *     An arbitrary string representing the name of some component of the
     *     on-screen keyboard.
     *
     * @returns {String}
     *     A string formatted for use as a CSS class name.
     */
    var getCSSName = function getCSSName(name) {

        // Convert name from possibly-CamelCase to hyphenated lowercase
        var cssName = name
               .replace(/([a-z])([A-Z])/g, '$1-$2')
               .replace(/[^A-Za-z0-9]+/g, '-')
               .toLowerCase();

        return cssName;

    };

    /**
     * Appends DOM elements to the given element as dictated by the layout
     * structure object provided. If a name is provided, an additional CSS
     * class, prepended with "guac-keyboard-", will be added to the top-level
     * element.
     *
     * If the layout structure object is an array, all elements within that
     * array will be recursively appended as children of a group, and the
     * top-level element will be given the CSS class "guac-keyboard-group".
     *
     * If the layout structure object is an object, all properties within that
     * object will be recursively appended as children of a group, and the
     * top-level element will be given the CSS class "guac-keyboard-group". The
     * name of each property will be applied as the name of each child object
     * for the sake of CSS. Each property will be added in sorted order.
     *
     * If the layout structure object is a string, the key having that name
     * will be appended. The key will be given the CSS class
     * "guac-keyboard-key" and "guac-keyboard-key-NAME", where NAME is the name
     * of the key. If the name of the key is a single character, this will
     * first be transformed into the C-style hexadecimal literal for the
     * Unicode codepoint of that character. For example, the key "A" would
     * become "guac-keyboard-key-0x41".
     *
     * If the layout structure object is a number, a gap of that size will be
     * inserted. The gap will be given the CSS class "guac-keyboard-gap", and
     * will be scaled according to the same size units as each key.
     *
     * @private
     * @param {Element} element
     *     The element to append elements to.
     *
     * @param {Array|Object|String|Number} object
     *     The layout structure object to use when constructing the elements to
     *     append.
     *
     * @param {String} [name]
     *     The name of the top-level element being appended, if any.
     */
    var appendElements = function appendElements(element, object, name) {

        var i;

        // Create div which will become the group or key
        var div = document.createElement('div');

        // Add class based on name, if name given
        if (name)
            addClass(div, 'guac-keyboard-' + getCSSName(name));

        // If an array, append each element
        if (object instanceof Array) {

            // Add group class
            addClass(div, 'guac-keyboard-group');

            // Append all elements of array
            for (i=0; i < object.length; i++)
                appendElements(div, object[i]);

        }

        // If an object, append each property value
        else if (object instanceof Object) {

            // Add group class
            addClass(div, 'guac-keyboard-group');

            // Append all children, sorted by name
            var names = Object.keys(object).sort();
            for (i=0; i < names.length; i++) {
                var name = names[i];
                appendElements(div, object[name], name);
            }

        }

        // If a number, create as a gap
        else if (typeof object === 'number') {

            // Add gap class
            addClass(div, 'guac-keyboard-gap');

            // Maintain scale
            scaledElements.push(new ScaledElement(div, object, object));

        }

        // If a string, create as a key
        else if (typeof object === 'string') {

            // If key name is only one character, use codepoint for name
            var keyName = object;
            if (keyName.length === 1)
                keyName = '0x' + keyName.charCodeAt(0).toString(16);

            // Add key container class
            addClass(div, 'guac-keyboard-key-container');

            // Create key element which will contain all possible caps
            var keyElement = document.createElement('div');
            keyElement.className = 'guac-keyboard-key '
                                 + 'guac-keyboard-key-' + getCSSName(keyName);

            // Add all associated keys as caps within DOM
            var keys = osk.keys[object];
            if (keys) {
                for (i=0; i < keys.length; i++) {

                    // Get current key
                    var key = keys[i];

                    // Create cap element for key
                    var capElement = document.createElement('div');
                    capElement.className   = 'guac-keyboard-cap';
                    capElement.textContent = key.title;

                    // Add classes for any requirements
                    for (var j=0; j < key.requires.length; j++) {
                        var requirement = key.requires[j];
                        addClass(capElement, 'guac-keyboard-requires-' + getCSSName(requirement));
                        addClass(keyElement, 'guac-keyboard-uses-'     + getCSSName(requirement));
                    }

                    // Add cap to key within DOM
                    keyElement.appendChild(capElement);

                }
            }

            // Add key to DOM, maintain scale
            div.appendChild(keyElement);
            scaledElements.push(new ScaledElement(div, osk.layout.keyWidths[object] || 1, 1, true));

            /**
             * Handles a touch event which results in the pressing of an OSK
             * key. Touch events will result in mouse events being ignored for
             * touchMouseThreshold events.
             *
             * @private
             * @param {TouchEvent} e
             *     The touch event being handled.
             */
            var touchPress = function touchPress(e) {
                e.preventDefault();
                ignoreMouse = osk.touchMouseThreshold;
                press(object, keyElement);
            };

            /**
             * Handles a touch event which results in the release of an OSK
             * key. Touch events will result in mouse events being ignored for
             * touchMouseThreshold events.
             *
             * @private
             * @param {TouchEvent} e
             *     The touch event being handled.
             */
            var touchRelease = function touchRelease(e) {
                e.preventDefault();
                ignoreMouse = osk.touchMouseThreshold;
                release(object, keyElement);
            };

            /**
             * Handles a mouse event which results in the pressing of an OSK
             * key. If mouse events are currently being ignored, this handler
             * does nothing.
             *
             * @private
             * @param {MouseEvent} e
             *     The touch event being handled.
             */
            var mousePress = function mousePress(e) {
                e.preventDefault();
                if (ignoreMouse === 0)
                    press(object, keyElement);
            };

            /**
             * Handles a mouse event which results in the release of an OSK
             * key. If mouse events are currently being ignored, this handler
             * does nothing.
             *
             * @private
             * @param {MouseEvent} e
             *     The touch event being handled.
             */
            var mouseRelease = function mouseRelease(e) {
                e.preventDefault();
                if (ignoreMouse === 0)
                    release(object, keyElement);
            };

            // Handle touch events on key
            keyElement.addEventListener("touchstart", touchPress,   true);
            keyElement.addEventListener("touchend",   touchRelease, true);

            // Handle mouse events on key
            keyElement.addEventListener("mousedown", mousePress,   true);
            keyElement.addEventListener("mouseup",   mouseRelease, true);
            keyElement.addEventListener("mouseout",  mouseRelease, true);

        } // end if object is key name

        // Add newly-created group/key
        element.appendChild(div);

    };

    // Create keyboard layout in DOM
    appendElements(keyboard, layout.layout);

}
/**
 * Represents an entire on-screen keyboard layout, including all available
 * keys, their behaviors, and their relative position and sizing.
 *
 * @constructor
 * @param {OnScreenKeyboard.Layout|Object} template
 *     The object whose identically-named properties will be used to initialize
 *     the properties of this layout.
 */
OnScreenKeyboard.Layout = function(template) {

    /**
     * The language of keyboard layout, such as "en_US". This property is for
     * informational purposes only, but it is recommend to conform to the
     * [language code]_[country code] format.
     *
     * @type {String}
     */
    this.language = template.language;

    /**
     * The type of keyboard layout, such as "qwerty". This property is for
     * informational purposes only, and does not conform to any standard.
     *
     * @type {String}
     */
    this.type = template.type;

    /**
     * Map of key name to corresponding keysym, title, or key object. If only
     * the keysym or title is provided, the key object will be created
     * implicitly. In all cases, the name property of the key object will be
     * taken from the name given in the mapping.
     *
     * @type {Object.<String, Number|String|OnScreenKeyboard.Key|OnScreenKeyboard.Key[]>}
     */
    this.keys = template.keys;

    /**
     * Arbitrarily nested, arbitrarily grouped key names. The contents of the
     * layout will be traversed to produce an identically-nested grouping of
     * keys in the DOM tree. All strings will be transformed into their
     * corresponding sets of keys, while all objects and arrays will be
     * transformed into named groups and anonymous groups respectively. Any
     * numbers present will be transformed into gaps of that size, scaled
     * according to the same units as each key.
     *
     * @type {Object}
     */
    this.layout = template.layout;

    /**
     * The width of the entire keyboard, in arbitrary units. The width of each
     * key is relative to this width, as both width values are assumed to be in
     * the same units. The conversion factor between these units and pixels is
     * derived later via a call to resize() on the OnScreenKeyboard.
     *
     * @type {Number}
     */
    this.width = template.width;

    /**
     * The width of each key, in arbitrary units, relative to other keys in
     * this layout. The true pixel size of each key will be determined by the
     * overall size of the keyboard. If not defined here, the width of each
     * key will default to 1.
     *
     * @type {Object.<String, Number>}
     */
    this.keyWidths = template.keyWidths || {};

};

/**
 * Represents a single key, or a single possible behavior of a key. Each key
 * on the on-screen keyboard must have at least one associated
 * OnScreenKeyboard.Key, whether that key is explicitly defined or
 * implied, and may have multiple OnScreenKeyboard.Key if behavior
 * depends on modifier states.
 *
 * @constructor
 * @param {OnScreenKeyboard.Key|Object} template
 *     The object whose identically-named properties will be used to initialize
 *     the properties of this key.
 *
 * @param {String} [name]
 *     The name to use instead of any name provided within the template, if
 *     any. If omitted, the name within the template will be used, assuming the
 *     template contains a name.
 */
OnScreenKeyboard.Key = function(template, name) {

    /**
     * The unique name identifying this key within the keyboard layout.
     *
     * @type {String}
     */
    this.name = name || template.name;

    /**
     * The human-readable title that will be displayed to the user within the
     * key. If not provided, this will be derived from the key name.
     *
     * @type {String}
     */
    this.title = template.title || this.name;

    /**
     * The keysym to be pressed/released when this key is pressed/released. If
     * not provided, this will be derived from the title if the title is a
     * single character.
     *
     * @type {Number}
     */
    this.keysym = template.keysym || (function deriveKeysym(title) {

        // Do not derive keysym if title is not exactly one character
        if (!title || title.length !== 1)
            return null;

        // For characters between U+0000 and U+00FF, the keysym is the codepoint
        var charCode = title.charCodeAt(0);
        if (charCode >= 0x0000 && charCode <= 0x00FF)
            return charCode;

        // For characters between U+0100 and U+10FFFF, the keysym is the codepoint or'd with 0x01000000
        if (charCode >= 0x0100 && charCode <= 0x10FFFF)
            return 0x01000000 | charCode;

        // Unable to derive keysym
        return null;

    })(this.title);

    /**
     * The name of the modifier set when the key is pressed and cleared when
     * this key is released, if any. The names of modifiers are distinct from
     * the names of keys; both the "RightShift" and "LeftShift" keys may set
     * the "shift" modifier, for example. By default, the key will affect no
     * modifiers.
     *
     * @type {String}
     */
    this.modifier = template.modifier;

    /**
     * An array containing the names of each modifier required for this key to
     * have an effect. For example, a lowercase letter may require nothing,
     * while an uppercase letter would require "shift", assuming the Shift key
     * is named "shift" within the layout. By default, the key will require
     * no modifiers.
     *
     * @type {String[]}
     */
    this.requires = template.requires || [];

};

/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * The unique ID of this version of the Guacamole JavaScript API. This ID will
 * be the version string of the guacamole-common-js Maven project, and can be
 * used in downstream applications as a sanity check that the proper version
 * of the APIs is being used (in case an older version is cached, for example).
 *
 * @type {String}
 */
var Version = "0.9.9";

/*
 * Copyright (C) 2013 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Guacamole Tunnel implemented over WebSocket via XMLHttpRequest.
 *
 * @constructor
 * @augments Tunnel
 * @param {String} tunnelURL The URL of the WebSocket tunneling service.
 */
function WebSocketTunnel(tunnelURL) {

    /**
     * Reference to this WebSocket tunnel.
     * @private
     */
    var tunnel = this;

    /**
     * The WebSocket used by this tunnel.
     * @private
     */
    var socket = null;

    /**
     * The current receive timeout ID, if any.
     * @private
     */
    var receive_timeout = null;

    /**
     * The WebSocket protocol corresponding to the protocol used for the current
     * location.
     * @private
     */
    var ws_protocol = {
        "http:":  "ws:",
        "https:": "wss:"
    };

    // Transform current URL to WebSocket URL

    // If not already a websocket URL
    if (   tunnelURL.substring(0, 3) !== "ws:"
        && tunnelURL.substring(0, 4) !== "wss:") {

        var protocol = ws_protocol[window.location.protocol];

        // If absolute URL, convert to absolute WS URL
        if (tunnelURL.substring(0, 1) === "/")
            tunnelURL =
                protocol
                + "//" + window.location.host
                + tunnelURL;

        // Otherwise, construct absolute from relative URL
        else {

            // Get path from pathname
            var slash = window.location.pathname.lastIndexOf("/");
            var path  = window.location.pathname.substring(0, slash + 1);

            // Construct absolute URL
            tunnelURL =
                protocol
                + "//" + window.location.host
                + path
                + tunnelURL;

        }

    }

    /**
     * Initiates a timeout which, if data is not received, causes the tunnel
     * to close with an error.
     *
     * @private
     */
    function reset_timeout() {

        // Get rid of old timeout (if any)
        window.clearTimeout(receive_timeout);

        // Set new timeout
        receive_timeout = window.setTimeout(function () {
            close_tunnel(new Status(Status.Code.UPSTREAM_TIMEOUT, "Server timeout."));
        }, tunnel.receiveTimeout);

    }

    /**
     * Closes this tunnel, signaling the given status and corresponding
     * message, which will be sent to the onerror handler if the status is
     * an error status.
     *
     * @private
     * @param {Status} status The status causing the connection to
     *                                  close;
     */
    function close_tunnel(status) {

        // Ignore if already closed
        if (tunnel.state === Tunnel.State.CLOSED)
            return;

        // If connection closed abnormally, signal error.
        if (status.code !== Status.Code.SUCCESS && tunnel.onerror)
            tunnel.onerror(status);

        // Mark as closed
        tunnel.state = Tunnel.State.CLOSED;
        if (tunnel.onstatechange)
            tunnel.onstatechange(tunnel.state);

        socket.close();

    }

    this.sendMessage = function(elements) {

        // Do not attempt to send messages if not connected
        if (tunnel.state !== Tunnel.State.OPEN)
            return;

        // Do not attempt to send empty messages
        if (arguments.length === 0)
            return;

        /**
         * Converts the given value to a length/string pair for use as an
         * element in a Guacamole instruction.
         *
         * @private
         * @param value The value to convert.
         * @return {String} The converted value.
         */
        function getElement(value) {
            var string = new String(value);
            return string.length + "." + string;
        }

        // Initialized message with first element
        var message = getElement(arguments[0]);

        // Append remaining elements
        for (var i=1; i<arguments.length; i++)
            message += "," + getElement(arguments[i]);

        // Final terminator
        message += ";";

        socket.send(message);

    };

    this.connect = function(data) {

        reset_timeout();

        // Connect socket
        socket = new WebSocket(tunnelURL + "?" + data, "guacamole");

        socket.onopen = function(event) {

            reset_timeout();

            tunnel.state = Tunnel.State.OPEN;
            if (tunnel.onstatechange)
                tunnel.onstatechange(tunnel.state);

        };

        socket.onclose = function(event) {
            close_tunnel(new Status(parseInt(event.reason), event.reason));
        };

        socket.onerror = function(event) {
            close_tunnel(new Status(Status.Code.SERVER_ERROR, event.data));
        };

        socket.onmessage = function(event) {

            reset_timeout();

            var message = event.data;
            var startIndex = 0;
            var elementEnd;

            var elements = [];

            do {

                // Search for end of length
                var lengthEnd = message.indexOf(".", startIndex);
                if (lengthEnd !== -1) {

                    // Parse length
                    var length = parseInt(message.substring(elementEnd+1, lengthEnd));

                    // Calculate start of element
                    startIndex = lengthEnd + 1;

                    // Calculate location of element terminator
                    elementEnd = startIndex + length;

                }

                // If no period, incomplete instruction.
                else
                    close_tunnel(new Status(Status.Code.SERVER_ERROR, "Incomplete instruction."));

                // We now have enough data for the element. Parse.
                var element = message.substring(startIndex, elementEnd);
                var terminator = message.substring(elementEnd, elementEnd+1);

                // Add element to array
                elements.push(element);

                // If last element, handle instruction
                if (terminator === ";") {

                    // Get opcode
                    var opcode = elements.shift();

                    // Call instruction handler.
                    if (tunnel.oninstruction)
                        tunnel.oninstruction(opcode, elements);

                    // Clear elements
                    elements.length = 0;

                }

                // Start searching for length at character after
                // element terminator
                startIndex = elementEnd + 1;

            } while (startIndex < message.length);

        };

    };

    this.disconnect = function() {
        close_tunnel(new Status(Status.Code.SUCCESS, "Manually closed."));
    };

}
WebSocketTunnel.prototype = new Tunnel();

export { ArrayBufferReader, ArrayBufferWriter, AudioPlayer$1 as AudioPlayer, BlobReader, ChainedTunnel, Client, DataURIReader, Display$1 as Display, HTTPTunnel, InputStream, IntegerPool, guacamoleJSONReader as JSONReader, Keyboard$1 as Keyboard, Layer$1 as Layer, Mouse, guacamoleObject as Object, OnScreenKeyboard, OutputStream, Parser, RawAudioPlayer, Status$1 as Status, StringReader, StringWriter, Tunnel, Version, VideoPlayer, WebSocketTunnel };
