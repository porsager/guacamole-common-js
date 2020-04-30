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

import Tunnel from './Tunnel.js'
import Status from './Status.js'

/**
 * Guacamole Tunnel implemented over WebSocket via XMLHttpRequest.
 *
 * @constructor
 * @augments Tunnel
 * @param {String} tunnelURL The URL of the WebSocket tunneling service.
 */
export default function WebSocketTunnel(tunnelURL) {

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

};

WebSocketTunnel.prototype = new Tunnel();
