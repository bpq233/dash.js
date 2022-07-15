/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import ThroughputRule from './ThroughputRule';
import InsufficientBufferRule from './InsufficientBufferRule';
import AbandonRequestsRule from './AbandonRequestsRule';
import DroppedFramesRule from './DroppedFramesRule';
import SwitchHistoryRule from './SwitchHistoryRule';
import BolaRule from './BolaRule';
import L2ARule from './L2ARule.js';
import LoLPRule from './lolp/LoLpRule.js';
import FactoryMaker from '../../../core/FactoryMaker';
import SwitchRequest from '../SwitchRequest';
import Constants from '../../constants/Constants';

const QUALITY_SWITCH_RULES = 'qualitySwitchRules';
const ABANDON_FRAGMENT_RULES = 'abandonFragmentRules';


function ABRRulesCollection(config) {

    config = config || {};
    const context = this.context;

    const mediaPlayerModel = config.mediaPlayerModel;
    const customParametersModel = config.customParametersModel;
    const dashMetrics = config.dashMetrics;
    const settings = config.settings;

    let instance,
        qualitySwitchRules,
        abandonFragmentRules;

    function initialize() {
        qualitySwitchRules = [];
        abandonFragmentRules = [];

        if (settings.get().streaming.abr.useDefaultABRRules) {

            // If L2A is used we only need this one rule
            if (settings.get().streaming.abr.ABRStrategy === Constants.ABR_STRATEGY_L2A) {
                qualitySwitchRules.push(
                    L2ARule(context).create({
                        dashMetrics: dashMetrics,
                        settings: settings
                    })
                );
            }
            // If LoLP is used we only need this one rule
            else if (settings.get().streaming.abr.ABRStrategy === Constants.ABR_STRATEGY_LoLP) {
                qualitySwitchRules.push(
                    LoLPRule(context).create({
                        dashMetrics: dashMetrics
                    })
                );
            } else {
                // Only one of BolaRule and ThroughputRule will give a switchRequest.quality !== SwitchRequest.NO_CHANGE.
                // This is controlled by useBufferOccupancyABR mechanism in AbrController.
                qualitySwitchRules.push(
                    BolaRule(context).create({
                        dashMetrics: dashMetrics,
                        mediaPlayerModel: mediaPlayerModel,
                        settings: settings
                    })
                );

                qualitySwitchRules.push(
                    ThroughputRule(context).create({
                        dashMetrics: dashMetrics
                    })
                );

                if (settings.get().streaming.abr.additionalAbrRules.insufficientBufferRule) {
                    qualitySwitchRules.push(
                        InsufficientBufferRule(context).create({
                            dashMetrics: dashMetrics,
                            settings
                        })
                    );
                }

                if (settings.get().streaming.abr.additionalAbrRules.switchHistoryRule) {
                    qualitySwitchRules.push(
                        SwitchHistoryRule(context).create()
                    );
                }

                if (settings.get().streaming.abr.additionalAbrRules.droppedFramesRule) {
                    qualitySwitchRules.push(
                        DroppedFramesRule(context).create()
                    );
                }

                if (settings.get().streaming.abr.additionalAbrRules.abandonRequestsRule) {
                    abandonFragmentRules.push(
                        AbandonRequestsRule(context).create({
                            dashMetrics: dashMetrics,
                            mediaPlayerModel: mediaPlayerModel,
                            settings: settings
                        })
                    );
                }
            }
        }

        // add custom ABR rules if any
        const customRules = customParametersModel.getAbrCustomRules();
        customRules.forEach(function (rule) {
            if (rule.type === QUALITY_SWITCH_RULES) {
                qualitySwitchRules.push(rule.rule(context).create());
            }

            if (rule.type === ABANDON_FRAGMENT_RULES) {
                abandonFragmentRules.push(rule.rule(context).create());
            }
        });
    }

    function _getRulesWithChange(srArray) {
        return srArray.filter(sr => sr.quality > SwitchRequest.NO_CHANGE);
    }

    /**
     *
     * @param {array} srArray
     * @return {object} SwitchRequest
     */
    function getMinSwitchRequest(srArray) {
        const values = {};
        let newSwitchReq = null;
        let i,
            len,
            req,
            quality,
            reason;

        if (srArray.length === 0) {
            return;
        }

        values[SwitchRequest.PRIORITY.STRONG] = { quality: SwitchRequest.NO_CHANGE, reason: null };
        values[SwitchRequest.PRIORITY.WEAK] = { quality: SwitchRequest.NO_CHANGE, reason: null };
        values[SwitchRequest.PRIORITY.DEFAULT] = { quality: SwitchRequest.NO_CHANGE, reason: null };

        for (i = 0, len = srArray.length; i < len; i += 1) {
            req = srArray[i];
            if (req.quality !== SwitchRequest.NO_CHANGE) {
                // We only use the new quality in case it is lower than the already saved one or if no new quality has been selected for the respective priority
                if (values[req.priority].quality === SwitchRequest.NO_CHANGE || values[req.priority].quality > req.quality) {
                    values[req.priority].quality = req.quality;
                    values[req.priority].reason = req.reason || null;
                }
            }
        }

        if (values[SwitchRequest.PRIORITY.WEAK].quality !== SwitchRequest.NO_CHANGE) {
            newSwitchReq = values[SwitchRequest.PRIORITY.WEAK];
        }

        if (values[SwitchRequest.PRIORITY.DEFAULT].quality !== SwitchRequest.NO_CHANGE) {
            newSwitchReq = values[SwitchRequest.PRIORITY.DEFAULT];
        }

        if (values[SwitchRequest.PRIORITY.STRONG].quality !== SwitchRequest.NO_CHANGE) {
            newSwitchReq = values[SwitchRequest.PRIORITY.STRONG];
        }

        if (newSwitchReq) {
            quality = newSwitchReq.quality;
            reason = newSwitchReq.reason;
        }

        return SwitchRequest(context).create(quality, reason);
    }

    function getMaxQuality(rulesContext) {
        const switchRequestArray = qualitySwitchRules.map(rule => rule.getMaxIndex(rulesContext));
        const activeRules = _getRulesWithChange(switchRequestArray);
        const maxQuality = getMinSwitchRequest(activeRules);


        let bufferLevel = 0;
        let mediaType = rulesContext.getMediaInfo().type;
        bufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
    
        let requests = dashMetrics.getHttpRequests(mediaType);
		let lastRequest = null;
		let currentRequest = null;
		
		if(requests) {
			// 获取上一个有效的HTTP请求
            let i = requests.length - 1; 
            while(i >=0 && lastRequest === null) {
                currentRequest = requests[i];
                if (currentRequest._tfinish && currentRequest.trequest && currentRequest.tresponse && currentRequest.trace && currentRequest.trace.length > 0) {
                    lastRequest = requests[i];
                }
                i--;
            }
            if(lastRequest !== null && lastRequest.type === 'MediaSegment') {
                //console.log(lastRequest);
                // 视频块传输时间
                // trequest:客户端发送HTTP请求的时间点
                // tresponse:客户端接收到HTTP相应的第一个字节的时间点
                // _tfinish：客户端接受完HTTP相应的最后一个字节的时间点，既请求完成时间。
                
                let transmissionTime = (lastRequest._tfinish.getTime() - lastRequest.trequest.getTime()) / 1000;  // 单位为s 
                
                // 有了传输数据量（视频块大小）和传输时间，视频块吞吐量（单位为bps）则由视频块传输时间计算得到:
                let chunkSzie = lastRequest.trace.reduce(function (a, b) {
                    return a + b.b[0];
                }, 0);
                let throughput = chunkSzie / transmissionTime;
                throughput = throughput / 1024;
                //console.log('视频块大小为:' +chunkSzie / 1024+'KB');
                //console.log(throughput+'KBps');
                // 获取上一个视频块的码率级别
                let lastQuality = rulesContext.getRepresentationInfo().quality;
                //console.log('获取码率级别'+lastQuality);
                // 获取上一个视频块的时长 
                let chunkDuration = rulesContext.getRepresentationInfo().fragmentDuration;
                //console.log('上一个视频块时长'+chunkDuration);

                console.log(bufferLevel+','+chunkSzie+','+throughput+','+lastQuality+','+chunkDuration);
            }
        }


        return maxQuality || SwitchRequest(context).create();
    }

    function shouldAbandonFragment(rulesContext, streamId) {
        const abandonRequestArray = abandonFragmentRules.map(rule => rule.shouldAbandon(rulesContext, streamId));
        const activeRules = _getRulesWithChange(abandonRequestArray);
        const shouldAbandon = getMinSwitchRequest(activeRules);

        return shouldAbandon || SwitchRequest(context).create();
    }

    function reset() {
        [qualitySwitchRules, abandonFragmentRules].forEach(rules => {
            if (rules && rules.length) {
                rules.forEach(rule => rule.reset && rule.reset());
            }
        });
        qualitySwitchRules = [];
        abandonFragmentRules = [];
    }

    function getQualitySwitchRules() {
        return qualitySwitchRules;
    }

    instance = {
        initialize,
        reset,
        getMaxQuality,
        getMinSwitchRequest,
        shouldAbandonFragment,
        getQualitySwitchRules
    };

    return instance;
}

ABRRulesCollection.__dashjs_factory_name = 'ABRRulesCollection';
const factory = FactoryMaker.getClassFactory(ABRRulesCollection);
factory.QUALITY_SWITCH_RULES = QUALITY_SWITCH_RULES;
factory.ABANDON_FRAGMENT_RULES = ABANDON_FRAGMENT_RULES;
FactoryMaker.updateSingletonFactory(ABRRulesCollection.__dashjs_factory_name, factory);

export default factory;
