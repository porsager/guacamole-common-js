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
export default function HTTPTunnel(tunnelURL, crossDomain) {

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

};

HTTPTunnel.prototype = new Tunnel();
