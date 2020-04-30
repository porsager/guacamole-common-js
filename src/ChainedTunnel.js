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
export default function ChainedTunnel(tunnelChain) {

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

};

ChainedTunnel.prototype = new Tunnel();
