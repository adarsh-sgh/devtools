/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

// @flow

import React, { Component } from "react";
import PropTypes from "prop-types";

import { times, zip, flatten } from "lodash";

import "./PreviewFunction.css";

type FunctionType = {
  name: string,
  displayName?: string,
  userDisplayName?: string,
  parameterNames?: string[],
  location?: {
    url: string,
    line: number,
    column: number,
  },
};

type Props = { func: FunctionType };

const IGNORED_SOURCE_URLS = ["debugger eval code"];

export default class PreviewFunction extends Component<Props> {
  renderFunctionName(func: FunctionType) {
    const { l10n } = this.context;
    const name = func.name || l10n.getStr("anonymousFunction");
    return <span className="function-name">{name}</span>;
  }

  renderParams(func: FunctionType) {
    const parameterNames = func.parameterNames || [];
    const params = parameterNames
      .filter(i => i)
      .map(param => (
        <span className="param" key={param}>
          {param}
        </span>
      ));

    const commas = times(params.length - 1).map((_, i) => (
      <span className="delimiter" key={i}>
        {", "}
      </span>
    ));

    // $FlowIgnore
    return flatten(zip(params, commas));
  }

  jumpToDefinitionButton(func: FunctionType) {
    return null;

    const location = func.functionLocation();
    const locationURL = func.functionLocationURL();

    if (
      location &&
      locationURL &&
      !IGNORED_SOURCE_URLS.includes(locationURL)
    ) {
      const lastIndex = locationURL.lastIndexOf("/");

      return (
        <button
          className="jump-definition"
          draggable="false"
          title={`${locationURL.slice(lastIndex + 1)}:${location.line}`}
        />
      );
    }
  }

  render() {
    const { func } = this.props;
    return (
      <span className="function-signature">
        {this.renderFunctionName(func)}
        <span className="paren">(</span>
        {this.renderParams(func)}
        <span className="paren">)</span>
        {this.jumpToDefinitionButton(func)}
      </span>
    );
  }
}

PreviewFunction.contextTypes = { l10n: PropTypes.object };
