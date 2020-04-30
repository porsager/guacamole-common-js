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

import StringReader from './StringReader.js'

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
export default function guacamoleJSONReader(stream) {

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

};
