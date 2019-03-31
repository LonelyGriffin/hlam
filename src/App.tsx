import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import { Scene } from './game/scene';

class App extends Component {
  render() {
    return false;
  }
  componentDidMount() {
    const scene = new Scene();
    scene.init().then(() => scene.start());
  }
}

export default App;
