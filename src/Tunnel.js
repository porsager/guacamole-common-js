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

import Status from './Status.js'

/**
 * Core object providing abstract communication for Guacamole. This object
 * is a null implementation whose functions do nothing. Guacamole applications
 * should use {@link HTTPTunnel} instead, or implement their own tunnel based
 * on this one.
 *
 * @constructor
 * @see HTTPTunnel
 */
export default function Tunnel() {

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

};

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
